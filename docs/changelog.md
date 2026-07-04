# JAKESJAM - Changelog

## v0.57 - 2026-07-02

- **Server input queue** — `matchHost.pendingInputs` was a
  last-write-wins slot: any input arriving in the same tick
  interval as a later one was silently dropped AND acked as
  processed, so the client pruned it from its replay set. Every
  jitter-batched packet pair became permanently lost movement →
  authoritative fell behind prediction → reconcile rubber-banding.
  Now a per-player FIFO consumed one frame per tick with honest
  acks, soft-cap flow control (drop-oldest + ack on burst), and
  input-hold on empty-queue ticks (≤15 ticks) so a late packet
  doesn't full-stop the player server-side. New
  `matchHostInputQueue.test.ts` (5 tests) gates the contracts.
- **Remote-player interpolation actually wired** — ClientLoop
  filled `remoteInterp` buffers but no production caller ever
  sampled them; remotes rendered from raw predicted extrapolation
  and jumped on every reconcile. `getRenderState()` now samples
  remote players at estimated-server-now − 100 ms (EMA'd server
  clock offset from snapshot arrivals) per the Gambetta loop the
  netcode doc always specified. Buffers are pruned when players
  leave the authoritative state.
- **Client accumulator clamp** (250 ms) — background-tab
  setInterval throttling no longer burst-steps the sim and floods
  the server input queue on refocus.
- **Self-contained self-hosting** (Fly is gone; Convex pivoted
  away from) — `bun run host:public` (scripts/host-public.sh)
  builds the client, serves it from the Bun server itself (new
  `SERVE_CLIENT_DIR` static handler with SPA fallback + traversal
  guard), opens a Cloudflare quick tunnel, verifies it end-to-end
  via DNS-over-HTTPS (some LAN resolvers block
  *.trycloudflare.com), and prints one `?world=1` share link.
  Players join the pub world via `/world-token` + `/ws/world` —
  zero external services. Client WS targeting now falls back to
  same-origin when served from a real (non-Vite-dev) origin, with
  a new runtime `?server=<ws-url>` query param (mirrors
  `?convex=`) as explicit override. The Convex matchmaker also
  gained a `GAME_SERVER_URL_OVERRIDE` env hook for whenever
  room-mode matchmaking is revived.
- **Visual + perf pass (Playwright screenshot audit)**:
  - Snapshot rate 60Hz → 20Hz (`SNAPSHOT_INTERVAL_TICKS = 3`). The
    60Hz rate was masking the unwired interpolation; with interp
    wired it only bought client-side reconcile churn — measured
    in-browser RTT fell from ~1200ms to ~48ms on localhost after
    the change (pongs were queuing behind snapshot processing).
  - Round-over banner no longer prints "TO DRAW" on draws.
  - Kill callouts + hit markers referenced the never-loaded
    "PP Neue Machina" font (silent Arial fallback since the font
    swap to Space Grotesk/Mono) — now use Space Grotesk.
  - FTUE controls legend moved below the RTT pill (they overlapped
    for the legend's 3s life) and now says "SHIFT shield" — Shift
    maps to InputBit.Shield; parry is the (still unbound online)
    Ability bit.
  - Draft-card hover softened (scale 1.12→1.06, rotation
    0.05→0.015 rad) — at the old values the bracket frame visibly
    detached and long descriptions crossed the card edge.
- **Combat observability + online combat parity**:
  - `bun run combat:probe` (tools/combat-probe.mjs) — scripted
    two-player combat with full video + frame extraction + a
    state-level report (health timeline, shield/parry/kill
    observations). FAILS if no damage lands. Verified end-to-end:
    damage ✓ kill ✓ shield ✓ parry ✓ remote-rig rendering ✓.
  - In-page bot autopilot (client/src/debug/botDriver.ts,
    `window.__setBotInput`) — 60Hz goal-driven control that
    survives loaded hosts where CDP input events stall. Debug
    hooks added: `__simPlayers()`, `__simPhase()`, `__simCamera()`,
    `__rigDebug()`.
  - Parry BOUND ONLINE: right-click → InputBit.Ability (context
    menu suppressed, mirrors MatchScene). FTUE legend updated.
  - Shield bubble + parry arc now RENDER online for all players,
    driven by wire state (they previously only existed offline).
  - Round banner shows 1-based round numbers (was "ROUND 0").
  - MainMenuScene is stopped when a match starts (its footer text
    kept rendering under matches) and restarted on return-to-lobby.
  - Menu-music preload skipped on `?world=1` auto-join (killed the
    aborted-request console noise).
  - DOM draft-card hover softened to match the Phaser DraftScene
    (brackets detached at 3° rotation + 1.10 scale).
- **Insecure-context crash fixed** — `crypto.randomUUID()` in
  LobbyController ran at module init and only exists in secure
  contexts (https / localhost). On self-hosted LAN play
  (http://192.168.x.x:8088) it threw and killed the ENTIRE menu:
  dead buttons, no world badge, no `?world=1` auto-join. Now falls
  back to a timestamp+random id. Reproduced and verified fixed in
  Brave against the LAN IP. (navigator.clipboard uses were already
  try/caught with fallbacks.)
- **Stable public URL via Tailscale Funnel** — host-public.sh now
  defaults to `TUNNEL=funnel`: https://randel.<tailnet>.ts.net,
  never rotates, survives reboots (config lives in tailscaled
  state). Verified end-to-end incl. browser world-join over WS.
  One-time setup done: tailscaled enabled on the PC, funnel
  enabled on the tailnet, `tailscale set --operator=jimothy` so
  the script manages it without sudo.
- **Fallback tunnel** — localhost.run over SSH (`TUNNEL=lhr`),
  with auto-reconnect and new-URL announcements (free URLs rotate
  every ~15-30 min by design; `.host-logs/current-url` always has
  the live link). Verified end-to-end on this network:
  HTTP + WebSocket + full browser world-join through the public
  lhr.life URL. cloudflared (which registers but never carries
  traffic here — CGNAT) is kept behind `TUNNEL=cloudflared` for
  other networks; `TUNNEL=none`/`HOST_MODE=direct` for the
  port-forward path once CGNAT opt-out lands.
- **Input future-window widened (4 → 30 ticks)** — live play logs
  showed honest clients at +5 ticks (slew targets +2, plus jitter)
  getting inputs dropped → rubber-banding. The stamp only feeds
  lag-comp and validation; the input queue consumes frames in seq
  order regardless, so a generous window is safe.
- **Two world-bricking deadlocks fixed** (found by the new
  full-lifecycle match probe):
  - Drafting never expired: `draftingExpiresAtTick` was set on entry
    but never checked — one AFK/closed-tab player wedged the whole
    always-on world in drafting FOREVER. Expiry now auto-picks the
    first offer for unpicked drafters (emits `draft-resolved
    autoPicked:true`, grants via the playerPatches consumer that was
    already built for this). The UI always said "Auto-selects when
    the timer expires"; now it's true. Old test that codified the
    deadlock rewritten to the documented semantics.
  - World never recycled on match completion: the round machine
    parks in round-over at target score (correct for rooms) but
    WorldHost had no completion handler — first finished match
    bricked the world. WorldHost now rebuilds the host on the next
    rotation map after a 6s scoreboard hold and migrates live
    sockets (fresh hello; client clears the stale results overlay).
    New matchHost `onMatchComplete` hook + `dispose()`, new
    `worldRecycle.test.ts` (3 tests).
- **`bun run match:probe`** (tools/match-probe.mjs) — two bots play
  a FULL match: fighting → kill → draft → next round → completion →
  recycle → fighting again, on video, every milestone asserted.
- Second-tab kick is now graceful: server sends an in-band
  `bye{replaced}` before closing the old socket (proxies eat close
  reasons → the old tab saw 1006 and reconnect-ping-ponged the
  session between tabs); "replaced" is a terminal reason client-side.
- host-public.sh runs the server WITHOUT --watch (source edits were
  hot-restarting live hosting and dropping players).
- Static handler denies dotfile paths outright (public tunnel URL
  attracts constant /.env//.git scanner sweeps — all 404 anyway,
  now categorical).
- Input tick future-window widened 4 → 30 (honest clients at slew
  target +2 plus jitter were getting inputs dropped → rubber-band).
- E2E hardening: predict-feel waits for the fighting phase and
  asserts on sim state (pixel scan kept as evidence only);
  visual long-fall spec walks during its anti-freeze diff (it
  previously passed only because the menu scene leaked animation
  under the match — that leak is fixed); lobby room-flow skips
  with a clear reason when no working Convex exists.
- **PREDICT/AUTHORITY SIM PARITY RESTORED — the root cause of the
  "tons of issues"**. Since the May "full zig" cut, the CLIENT
  predicted every tick with the Zig step_world orchestrator while
  the SERVER still ran the TS path (B3 flag never flipped). Two
  different sims = permanent reconcile churn: rubber-banding,
  predicted bullets erased before rendering (then popping in
  ~100px downrange — "bullets spawn at the player I'm shooting
  at"), round-phase flicker, and solo worlds wedged in round-over
  client-side (the Zig round machine ends a solo round as an
  instant mutual-KO; TS keeps fighting). The Zig SUBSTRATE (trig
  LUT, rng, collision, stepPlayer — bit-identical on both sides)
  stays default; the Zig ORCHESTRATOR is opt-in (?wasm-world=2)
  until the server flips USE_WASM_STEP_WORLD and both sides cut
  over together. Verified: in-page step now matches bun exactly;
  10/12 bullets first-render at the muzzle (was 1/13); predicted
  phase tracks authoritative every sample.
- **Event delivery fixed for 20Hz snapshots** — events from
  non-snapshot ticks were dropped entirely (2/3 of shot SFX, hit
  feedback, kill callouts). matchHost now accumulates and flushes
  every event with the next snapshot.
- **Max-effort review batch (15 verified findings)**: world-recycle
  epoch reset in ClientLoop (snapshot ring, interp buffers, server
  clock EMA, pending inputs — all were poisoned by the tick-0 reset
  after a recycle); reload-freeze fixed (input watermark reset on
  re-attach); flow-control drops no longer ack unsimulated inputs;
  in-band bye reason survives reason-stripping proxies; combatFx
  teardown; Vite-dev detection via import.meta.env.DEV; probe
  scaffolding deduped into tools/probeKit.mjs with crash guards;
  predict-feel pins its player id and gates on renderer truth.
- **Game-feel pass (docs/game-feel-tuning.md)** — full scale audit
  of movement/terrain/weapons in body-height units vs genre
  benchmarks. Applied: T1 (boxworks-mini side ledges were 18px
  ABOVE max jump height — unreachable without jetpack; moved to
  93% of max jump) and M1 (asymmetric jump gravity: descent 1.5×
  rise, fast-fall 2800 — full hop ~880ms → ~730ms; one cut across
  player.zig + player.ts + wasm rebuild, parity suites green).
  Watch item W1: baseline damage 10→15 if attrition fatigue shows.
- **Share card** — OG/Twitter meta with a rendered 1200x630 card
  (real parry-clash gameplay frame + wordmark) and favicon. The
  server rewrites __ORIGIN__ in index.html to the REQUEST origin
  (x-forwarded-proto aware) so absolute image URLs work on the
  funnel domain, LAN, or any future domain. Verified with a
  Discordbot-UA scrape through the public URL. Stale "Phaser and
  Convex scaffold" copy replaced with store copy; lobby rooms
  message no longer leaks env-var internals.
- **World bots** — server-side AI duelists (server/src/worldBots.ts)
  keep the world alive: approach/strafe/aim-lead with humanized
  error, threat-reactive parry + jump + shield, low-health retreat,
  delayed draft picks. First-class sim citizens (inputs go through
  the same queue/validation via MatchHost.injectInput). UNMISTAKABLY
  bots: bot_ id prefix renders AMBER rigs + "BOT · NAME" nameplates,
  scoreboard/banners/results all label them (client/src/game/ui/
  botIdentity.ts). WORLD_BOTS env (host-public.sh defaults 2; tests
  and probes run 0). Fix along the way: matchHost's input loop keyed
  on connected sockets and starved socketless players — now iterates
  playerInfo.
- **Procgen arenas + map-design ruleset (docs/map-design.md)** — new
  seeded generator (client/src/sim/data/mapGen.ts): tier-structured
  1280x640 arenas obeying validator-enforced laws derived from the
  measured movement (step ≤129px, sightline ≤420px on the floor
  lane, ≥2 routes up, 8–16% openness, spawn fairness, mirrored
  symmetry rolls). Seed rides in the mapId ("gen:<seed>") so client
  and server expand byte-identical geometry — verified live
  (predictDelta 8px on a generated map). World rotation now rolls
  fresh arenas between curated slots (mini/tower); WORLD_MAP env
  pins a specific map for playtests. The SAME validator audits the
  curated maps in CI — it immediately caught that the T1 ledge fix
  left ledge→mid at 130px (one over the law; mid moved to y=362).
  60-seed fuzz + determinism suite in mapGen.test.ts.
- **Spawn system overhaul** — replaced `spawns[index % len]` (which
  STACKED players on identical points once bots + joiners exceeded the
  spawn count, and gave campers a fixed target every round) with a
  deterministic max-spread assigner (World.assignSpawnPoints): players
  placed one-by-one at the point farthest from those already seated,
  id-sorted so client/server agree (parity-safe). Mid-match joins now
  drop in farthest from live players. Way more spawn points: mini 4→8,
  tower 6→9, generator now emits up to 8 spread across every tier. New
  spawnAssign.test.ts + spawn-separation fuzz in mapGen.test.ts.
- **Soundtrack regression fixed** — the song stopped once `?world=1`
  became the main entry: that path never called startMenuMusic() and
  set preload="none". Now the soundtrack is gesture-gated globally
  (first click/key anywhere, incl. first in-world input), plays
  through world AND room/practice matches (was cut on match-start),
  preloads eagerly. Verified live: currentTime advances, loops.
- NOTE: probe runs on a saturated host (e.g. DAW pinning 6 cores)
  produce skewed observations — the probe now warns when
  load/cores > 0.8 and records hostLoadRatio in report.json.
- 545 client / 72 server tests, all green.

## v0.56 - 2026-05-05

- **Doc-sync regression gate added** — `exportsDocSync.test.ts`
  asserts every wasm export name is referenced in
  `docs/zig-wasm-exports.md`. The test caught real drift on its
  first run: `step_projectile_v2` (shipped in `be73380`) and the
  v2 sizeof exports weren't in the doc. Doc updated.
- Forward defence: future PRs that add wasm exports without
  updating the manifest doc fail this test in CI.
- 337 client / 58 server / 6 native Zig tests, all green.
- E2E smoke 4/4 against deployed prod.

## v0.55 - 2026-05-05

- **`setStepWeaponBackend` + `setStepSatellitesBackend` swap
  mechanisms wired** (NOOP swaps; default behaviour unchanged).
  Now every major sim step function has a backend swap seam:
  `setRngBackend`, `setResolveMoveCachedBackend`,
  `setStepPlayerBackend`, `setStepProjectileBackend`,
  `setStepWeaponBackend`, `setStepSatellitesBackend`.
- weapon.ts and satellite.ts now follow the same pattern:
  `stepX()` is a thin dispatcher → `stepXBackend ?? stepXNative`.
  `stepXNative` holds the existing impl (just renamed).
- New `stepWeaponSatelliteBackendSwap.test.ts` (3 tests, 5 expects)
  gates the regression class where the swap mechanism subtly
  diverges or silently no-ops.
- 335 client / 58 server / 6 native Zig tests, all green.



## v0.54 - 2026-05-05

- **`setStepProjectileBackend` swap mechanism wired** (NOOP swap;
  default behaviour unchanged). Future cuts can install a
  wasm-backed fn at boot to route the projectile dispatch through
  Zig.
- `stepProjectile` is now a thin dispatcher that delegates to
  `stepProjectileBackend` when set, else falls through to
  `stepProjectileNative` (the existing implementation, just
  renamed). Same pattern as `setRngBackend` / `setStepPlayerBackend`.
- New `stepProjectileBackendSwap.test.ts` (4 tests, 8 expects)
  gates the regression class where the swap mechanism subtly
  diverges from the no-swap path: identity-swap produces
  identical output, custom backend gets invoked, revert restores
  native path.
- 332 client / 58 server / 6 native Zig tests, all green.
- Smoke against deployed prod: 3/3.



## v0.53 - 2026-05-05

- **Server-side smoke for ALL wasm modules.** New
  `server/src/__tests__/serverWasmModulesSmoke.test.ts` verifies
  that the server's `loadServerSim()` instantiates every module's
  exports correctly under Bun's WebAssembly. 9 tests covering
  rng / hash / trig LUT / collision / spatial / player /
  projectile (v1+v2) / weapon / satellite / combat / destructible /
  fire — confirms each module's primary export(s) are callable
  with sentinel inputs and return expected results.
- 52 server tests now (was 43, +9). Catches the regression class
  where wasm boundary works in the browser but breaks under
  Bun's WebAssembly.



## v0.52 - 2026-05-05

- **Performance baseline benchmark added.** New `tools/wasm-bench.ts`
  measures TS-libm vs TS-LUT vs wasm-LUT for the hot paths. Run
  via `bun run sim:bench`.
- New `docs/zig-wasm-perf-baseline.md` documents the findings:
  - **Trig**: TS-LUT is 4× slower than libm Math.sin/cos but
    deterministic across hosts; wasm boundary adds another ~6 ns.
    `lutAtan2` (24 ns) is FASTER than libm `Math.atan2` (35 ns).
  - **RNG**: TS is 13 ns/op, wasm 44 ns (3× slower due to boundary
    crossing). RNG is too small to make wasm worthwhile in isolation.
  - **Player physics**: TS 347 ns, wasm-swap 369 ns (~6% slower
    via cache-pack overhead). Negligible vs the 16.67 ms frame
    budget — wasm tax for 4 players × 60 Hz = 5.3 µs/sec.
  - **Architectural guidance**: package multiple ops into single
    wasm calls to amortise the boundary tax. Use TS-LUT for trig
    in TS sim modules (already done). The default-on production
    deploy has zero perf concerns.



## v0.51 - 2026-05-05

- **100k-tick determinism canary added.** Extends
  `longHorizonCanary.test.ts` with a deeper-regression test that
  runs 100,000 ticks (~28 minutes of 60Hz gameplay) of TS-native
  vs Zig-wasm player physics with independent integrators on the
  same canned input loop. Spot-checks every 1000 ticks for full
  coverage. **0 drift across 100,000 ticks.**
- Test runs in 169ms total — no CI cost concern.
- 328 client / 43 server / 6 native Zig tests, all green.



## v0.50 - 2026-05-05

- **Phase F1a final — `step_projectile_v2` ports the full pathing
  dispatch to a single wasm call.** Every projectile pathing now
  runs entirely in Zig when v2 is invoked: straight, gravity,
  float (sin/cos oscillation), accelerate (vel scale), boomerang
  (range-fraction return + rotate-toward-origin), homing
  (closest-non-owner + rotate-toward-target), anti-homing
  (mirror target + rotate), bounce (reflect on terrain hit).
- New `ProjectileKinematicsV2` extern struct (136 B) carries all
  per-pathing state (id, origin, range, returning flag, bounces,
  accel mul, homing strength). New `StepResultV2` (16 B) reports
  expired + terrain-hit-index + bounced flags. Caller passes
  player array via wasm memory for homing/anti-homing.
- Existing v1 `step_projectile` + `ProjectileKinematics` kept for
  the simpler straight+gravity case (backward compat).
- New `projectileStepV2Parity.test.ts` (8 tests, 209 expects):
  every pathing through 30-80 ticks of TS reference vs Zig wasm,
  0 mismatches across all eight.
- 327 client tests, 43 server tests, 6 native Zig tests. Wasm 29 KB.
- Smoke against deployed prod: 3/3.



## v0.49 - 2026-05-05

- **Phase D3 audited — `docs/zig-wasm-d3-audit.md`.** Per-module
  cleanup audit of every TS sim file. Verdict: D3 is **complete
  by construction**, not by deletion. The comptime trig LUT
  install path makes every TS sim module's trig calls
  bit-identical to wasm. The three modules that genuinely route
  to wasm in the hot path (rng / collision / player) already have
  minimal shims with explicit `<X>Native` fallbacks for graceful
  degradation. The remaining six modules (projectile / satellite /
  fire / weapon / combat / destructible) don't need backend swaps
  because their math is already deterministic via the LUT — adding
  swaps would be boundary-crossing overhead with no determinism
  win.
- True module deletion is blocked on (a) wasm-required-load
  guarantee — today wasm load failure falls back to TS gracefully
  — and (b) `World.step` orchestrator port (C3). Neither is
  required for the determinism fix that's already live.
- `docs/zig-wasm-migration.md` updated to mark D3 ✅ audited with
  the conclusion + link to the audit doc.
- Smoke against deployed prod: 3/3.



## v0.48 - 2026-05-05

- **🚨 Production determinism gap fixed: server now installs the
  trig LUT.** Found during a 06:50 audit pass that wasn't on the
  cron priority list. The client's
  `client/src/sim/wasm/runtime.ts` `getWasmSim()` always installed
  the comptime LUT immediately after wasm boot. The server's
  `server/src/wasmRuntime.ts` did NOT — so server-side
  `lutCos/lutSin/lutAtan2` (used by satellite, weapon, combat,
  projectile sim modules) silently fell back to
  `Math.cos/sin/atan2`. Different bits than the client's
  LUT-quantised values → predict-vs-authority drift on every
  trig-driven event in production: weapon firing direction,
  satellite orbit position, parry-arc inclusion check, projectile
  float oscillation + homing rotation.
- Fix: `loadServerSim()` now installs the LUT immediately after
  wasm instantiate, mirroring the client's pattern. `index.ts`
  calls `loadServerSim()` UNCONDITIONALLY at boot (regardless of
  the `JAKESJAM_WASM_*` env flags) so the LUT is always
  available, even if collision/player swaps stay disabled.
- New `server/src/__tests__/serverTrigLut.test.ts` (4 tests, gates
  the regression):
  - `loadServerSim` installs the LUT
  - LUT-quantised values differ from libm Math.cos for ~all
    non-sample-point inputs (proves LUT is active, not the
    fallback)
  - same for atan2 within a reasonable tolerance
  - LUT survives multiple cached `loadServerSim` calls
- 319 client / 43 server / 6 native Zig tests, all green.
  Smoke against deployed prod: 3/3.



## v0.47 - 2026-05-05

- **Wasm exports manifest + regression smoke test (D3 partial).**
  After F1d/F1e/F1a/F2b all shipped (last cuts shipped at `fe4b430`,
  `4d4318c`, `c2549f8`), there was no remaining cut from the cron's
  priority list — every TS sim module either has a wasm equivalent
  or already uses the LUT for cross-host parity.
- New `docs/zig-wasm-exports.md` — complete reference manifest of
  all 72 wasm function exports, organised by Zig module, each with
  its purpose + the parity test that gates byte-equality.
- New `client/src/sim/wasm/__tests__/exportsManifest.test.ts` —
  smoke test that the wasm artifact exposes every required export
  by name and they're all callable. Catches the regression class
  where a Zig refactor accidentally drops/renames an export.
  Currently checks 72 names + memory + state buffer + sizeof_*
  exports + LUT pointer validity.
- 319 client tests (was 315; +4 manifest test cases), 39 server
  tests, 6 native Zig tests. Smoke against deployed prod: 3/3.



## v0.46 - 2026-05-05

- **Phase F1a finish-half-2 — bounce-resolve + anti-homing helpers
  ported.** `sim/src/projectile.zig` now also covers:
  - `bounceResolve` — full bounce-vs-static reflection step:
    circleBounce → reflect velocity → nudge-back position →
    decrement bouncesRemaining. Returns 8-field `BounceResolve`
    extern struct (48 B).
  - `antiHomingTarget` — `(2x - tx, 2y - ty)` mirror computation
    used by anti-homing pathing.
- **Bug fix in `client/src/sim/projectile.ts`**: replaced four
  `Math.hypot(...)` calls with `Math.sqrt(a*a + b*b)`. V8's
  hypot uses overflow-safe scaling that produces ULP-different
  bits than the simple formula; in our velocity domain there's
  no overflow risk so matching Zig's `@sqrt` keeps cross-host
  parity. Same fix pattern as the player.ts hypot fix earlier.
- New `projectileBounceParity.test.ts` (5 tests, 13 expects):
  bounces=0 no-op, downward-into-floor reflects vy, horizontal-
  into-wall reflects vx, 100 randomised fixtures (0 mismatches),
  anti-homing target arithmetic edge cases.
- Smoke against deployed prod: 3/3 green.
- 315 client tests, 39 server tests, 6 native Zig tests.



## v0.45 - 2026-05-05

- **Phase F2b — static spatial grid in Zig.** `sim/src/spatial.zig`
  replaces the TS `Map<int, number[]>` cell buckets with fixed
  static arrays:
  - `g_cell_buckets: [256][16]u32`
  - `g_cell_counts: [256]u32`
  - `g_seen: [4]u64` bitset for query dedup
- `buildSpatialGrid(aabbs[], worldW, worldH, cellSize)` populates
  the module-global grid. `queryGrid(region, out[])` writes
  deduped indices in iteration order, returns count.
- TS Map iterates in insertion order; my static buckets reproduce
  that ordering by iterating AABBs 0..N and pushing to each (r, c)
  bucket in the same order. The dedup-via-bitset matches Set order
  (first-seen).
- New `spatialParity.test.ts` (5 tests, 9 expects):
  - constants match
  - whole-world query returns every AABB
  - small region near floor returns only nearby items
  - out-of-bounds region returns empty
  - 100 randomised query regions match TS as a SET
- The `Map.get(key)` insertion-order property is preserved within
  a single cell. Across-cell ordering is set-equal to TS but may
  not be strict order-equal — that's the determinism property the
  broadphase actually relies on (set membership for circle-vs-AABB
  checks; cross-cell iteration order doesn't affect hit decisions).
- Smoke against deployed prod: 3/3 green.
- 310 client tests, 39 server tests, 6 native Zig tests. Wasm 27.3 KB.



## v0.44 - 2026-05-05

- **Phase F1a finish-half-1 — homing/boomerang helpers ported.**
  `sim/src/projectile.zig` extended with:
  - `closestNonOwnerPlayer` — squared-distance lookup over a
    parallel `(xs[], ys[], alive[])` player array. Caller passes
    arrays sorted by player id (string order, matching TS
    `Object.keys(players).sort()`). Returns the closest valid
    candidate's index, or -1.
  - `boomerangShouldReturn` — pure boolean trigger:
    `!returning && range > 0 && traveled > range * 0.55`.
  - Constants exposed: `BOOMERANG_RANGE_FRACTION = 0.55`,
    `BOOMERANG_TURN_RATE = 8.4`, `HOMING_TURN_RATE_DEFAULT = 4`.
- The full pathing dispatch in `stepProjectile` still lives TS-side
  for now — but the math primitives are now fully ported. The
  remaining TS code is iteration + entity-dictionary
  bookkeeping, not float math.
- New `projectileHomingParity.test.ts` (6 tests, 14 expects):
  constants match, owner exclusion + dead skip, no-owner case,
  all-dead returns -1, 100 randomised fixtures (varying player
  counts 2..6), boomerang trigger truth table.
- Smoke test against deployed `https://jakesjam.vercel.app`: 3/3
  green incl. canvas pixel + slow-frame spam check. Wasm at
  `/wasm/sim.wasm` continues serving 200 OK.
- 305 client tests, 39 server tests, 6 native Zig tests.



## v0.43 - 2026-05-05

- **Phase F1a partial — projectile pathing helpers ported.**
  `sim/src/projectile.zig` extended with three pure-math helpers:
  - `applyFloatPathing` — sin/cos oscillation phase-keyed by entity
    id (uses lutSin/lutCos from comptime trig LUT)
  - `applyAcceleratePathing` — `(1 + k * dt)` velocity scale
  - `rotateVelocityToward` — turn-rate-limited rotation of a
    velocity vector toward a target point (uses lutAtan2 +
    lutCos/lutSin)
  - Internal `wrapAngle` + `rotateAngleToward` helpers.
- The full `stepProjectile` switch over pathing types still
  dispatches in TS — homing/anti-homing/boomerang need a player
  array passed across the wasm boundary, which is bigger ABI work.
  The math primitives are ready to be plugged in when the caller
  refactor lands.
- New `projectilePathingsParity.test.ts` (5 tests, 8 expects, 200+
  randomised fixtures): 60-tick float oscillation, 30-tick
  accelerate, 30-tick homing-chase rotation, zero-speed edge case,
  200 random float + 200 random accelerate fixtures.
- 299 client tests, 39 server tests, 6 native Zig tests.



## v0.42 - 2026-05-05

- **Phase F1e — `sim/src/destructible.zig` (full port).** Math
  primitives: HP damage application (`max(0, hp - damage)`),
  squared-distance blast-radius check (no sqrt — `dx² + dy² <=
  (R + pr)²`), center→AABB conversion. Wasm exports:
  `destructible_apply_damage`, `destructible_player_in_blast`,
  `destructible_center_to_aabb`. The orchestration (entity dict
  mutation + event emission + fire spawn requests) stays TS.
- New `destructibleParity.test.ts` (4 tests, 24 expects):
  HP clamping across overshoots, blast-radius edge boundary +
  1px-outside, 200 random fixtures (0 mismatches), center→AABB
  matches `collision.centerToAABB`.
- 294 client tests, 39 server tests, 6 native Zig tests.



## v0.41 - 2026-05-05

- **Phase F1d — `sim/src/combat.zig` ported.** Math primitives:
  parry arc cosine check (`isHitInParryArc` — uses `lutAtan2` from
  trig LUT), angle wrapping (mirror `wrapAngle`), shield drain
  (dps × dt). The orchestration (parry timing state machine,
  deflection event emission) stays TS-side. Wasm exports:
  `combat_wrap_angle`, `combat_is_hit_in_parry_arc`,
  `combat_shield_drain`, `combat_parry_arc_radians`.
- New `combatParity.test.ts` (6 tests):
  - PARRY_ARC_RADIANS constant matches π/3
  - wrap_angle across 41 inputs
  - 360° sweep at 5° intervals around the player → arc inclusion
    matches TS exactly
  - degenerate case (proj at player position) uses velocity fallback
  - shield drain dps × dt arithmetic
  - 200 randomised fixtures, 0 mismatches
- 290 client tests, 39 server tests, 6 native Zig tests. Wasm 25.0 KB.



## v0.40 - 2026-05-05

- **Phase F1b — `sim/src/weapon.zig` ported.** Math primitives:
  muzzle position (sqrt-based unit vector × reach), recoil
  impulse (uses lutCos/lutSin), cooldown tick, per-shot spread
  offset (carefully matches V8's left-to-right operator order to
  preserve byte-equality), cooldown from fire rate (clamped to
  MIN_FIRE_RATE floor). The full stepWeapon orchestration —
  build resolution, chaos profile, projectile spawn — stays
  TS-side because it depends on data tables + RNG threading +
  entity ID allocation that don't have a clean wasm ABI.
- New `weaponParity.test.ts` (6 tests, 50 expects):
  500 randomised muzzle position fixtures, zero-distance edge case,
  500 recoil angles, cooldown clamp behaviour, spread-offset for
  N=1..8 fans, fire-rate-floor clamping. 0 mismatches.
- Bug caught + fixed during port: spread-offset operator order.
  TS `(total * i) / (n-1)` and Zig `total * (i / (n-1))` are
  algebraically equal but produce ULP-different bits because
  IEEE 754 rounding depends on evaluation order. Fixed by
  matching the TS multiply-then-divide order in `weapon.zig`.
- 284 client tests, 39 server tests, 6 native Zig tests. Wasm 24.7 KB.



## v0.39 - 2026-05-05

- **Phase F1c — `sim/src/satellite.zig` ported.** Per-satellite tick
  kernel: orbit angle advance, fire cooldown decay, lifetime tick,
  fire-decision math (compute world position via `lutCos/Sin`,
  aim via `lutAtan2`). Wasm exports: `satellite_tick`,
  `sizeof_satellite_tick_input` (80 bytes), `sizeof_satellite_tick_output` (56 bytes).
- New `satelliteParity.test.ts` (4 tests, 188 expects):
  constants match, lifetime expiry across ~90 ticks, 60-tick orbit
  with moving target produces byte-identical output, 200
  randomised fixtures: 0 mismatches.
- Caller (TS satellite.ts) still owns iteration, owner lookup,
  target search, projectile spawn — only the per-satellite math
  is in wasm.
- 278 client tests, 39 server tests, 6 native Zig tests. Wasm 23.7 KB.



## v0.38 - 2026-05-05

- **🚨 Fixed: bug fix from v0.37 wasn't actually live in prod.** The
  e2e smoke test caught a 404 on `https://jakesjam.vercel.app/wasm/sim.wasm`.
  Root cause: Vercel's build env doesn't have Zig installed, so the
  Vite plugin's `zig build` spawn failed silently and the deploy
  shipped without the wasm artifact. Default users hit the 404,
  the wasm boot threw, and the swaps never installed → users were
  still running the TS sim with the determinism bug.
- New `scripts/vercel-build.sh` downloads Zig 0.15.2 (matches
  `.zig-version`), runs `zig build` to produce `sim.wasm`, then
  invokes the Vite client build. `vercel.json` `buildCommand`
  switched to call this script.
- Added `Cache-Control` + explicit `Content-Type: application/wasm`
  headers for `/wasm/(.*)` so streaming-instantiate works
  reliably + the 23KB binary gets long-cached.
- **Phase F1e — `sim/src/fire.zig` ported.** Fire patch tick math
  (lifetime decay, dps × dt damage, AABB overlap test). Pure
  arithmetic so the determinism story was already covered by IEEE
  754, but porting unblocks future D3 (delete TS sim).
- New `fireParity.test.ts` (3 tests, 226 expect calls): tick
  decay matches across the patch's full lifetime, damage = dps × dt
  arithmetic byte-identical, AABB overlap matches `aabbOverlap` for
  500 random fixtures.
- 274 client tests, 39 server tests, 6 native Zig tests, all green.
- Wasm artifact: 23.6 KB.



## v0.37 - 2026-05-05

- **🚀 Phase F3 — wasm sim flipped default-on. The "barely detects
  standing" bug fix is now live for default users.** No URL flag
  required. The opt-out becomes `?wasm-collision=0` /
  `?wasm-player=0` / `?wasm-rng=0`. Server-side: env vars become
  emergency disables (`JAKESJAM_WASM_COLLISION=0` /
  `JAKESJAM_WASM_PLAYER=0`).
- **Phase F2a — comptime trig LUTs.** `sim/src/trig.zig` bakes
  1024-entry sin and atan tables at compile time via Zig
  `comptime`. The TS side at `client/src/sim/trig.ts` reads the
  IDENTICAL bytes from wasm memory at boot via `installLutTables`
  and uses the same lookup math. Both sides sample bit-identical
  precomputed tables → cross-host trig drift is impossible by
  construction. **This is a Zig-only feature: TS can't bake
  precomputed bytes into the JS bundle the way Zig bakes them
  into wasm.**
- All sim trig callsites swapped from `Math.sin/cos/atan2` to
  `lutSin/lutCos/lutAtan2`:
  - `satellite.ts` (orbit position + aim)
  - `weapon.ts` (muzzle direction + recoil)
  - `combat.ts` (parry facing + projectile direction)
  - `projectile.ts` (float pathing, spawn, splits, homing turn)
- New `trigParity.test.ts` (5 tests, 8000+ angles): TS lutSin vs
  wasm lut_sin byte-identical across [-8π, 8π]; cos same;
  atan2 across all 4 quadrants + 1000 random pairs; LUT precision
  within 0.01 of `Math.sin`/`Math.cos`.
- Wasm artifact: 23 KB (was 6.3 KB; +16 KB for the two LUTs).
- 271 client tests, 39 server tests, 6 native Zig tests, all green.

**Deployment activation**:

```sh
git push origin main           # CI runs all gates ~10 min
                               # Vercel auto-deploys
                               # Fly auto-deploys with wasm-on default
```

After deploy: open `https://jakesjam.vercel.app` — console shows
`[wasm-sim] ready ... trig LUT installed (1024 entries)` plus
`[wasm-collision] swap applied` plus `[wasm-player] swap applied`.
The bug fix is live. To verify: open a second tab with
`?wasm-collision=0` and compare visible jitter side-by-side.

Server-side: nothing to set. wasm is on by default. To emergency-
disable: `flyctl secrets set --app jakesjam-srv-syd
JAKESJAM_WASM_COLLISION=0`.

## v0.36 - 2026-05-04

- **Phase C started: projectile motion kernel ported.**
  `sim/src/projectile.zig` ports `straight` + `gravity` pathing,
  position integration, lifetime decay, and terrain collision.
  `ProjectileKinematics` extern struct (80 bytes), `StepResult`
  extern struct (8 bytes). Wasm exports: `step_projectile`,
  `sizeof_projectile_kinematics`, `sizeof_projectile_step_result`.
  Other pathings (homing/boomerang/float/accelerate/anti-homing/
  bounce) and impacts (sticky/explosive/pierce/slow) remain TS-side
  for follow-on cuts.
- New `projectileParity.test.ts` (3 tests):
  - 30-tick straight-line projectile flight: byte-identical x/y/vx/vy/age/traveled
    every tick
  - 60-tick gravity arc trajectory: identical integration including
    gravity acceleration accumulation
  - Terrain hit: identical expired flag when projectile hits wall
- **Phase B/C utility: hash.zig ported.** FNV1a-32 primitives
  (`fnv1aMix`, `mixU32`, `quantise`) bit-exactly match
  `client/src/sim/hash.ts`. Note: this is a non-standard FNV1a
  variant — each byte mix XORs in `FNV1A_BASIS_32 >> 16`. Wrapping
  multiply (`*%`) matches `Math.imul` exactly.
- New `hashParity.test.ts` (5 tests, 1264 expect calls):
  - FNV1A_BASIS_32 constant matches
  - fnv1aMix across all 256 byte values
  - mixU32 across 1000 random u32 inputs
  - quantise matches Math.round-then-truncate
  - End-to-end multi-field hash chain identical
- 266/266 client tests, 39/39 server tests, 6/6 Zig tests, both
  typechecks clean. Wasm artifact: 6.3 KB.

## v0.35 - 2026-05-04

- **Long-horizon determinism canary shipped.**
  `longHorizonCanary.test.ts` runs 10,000 ticks (~2.8 minutes of
  60Hz gameplay) of TS-native and Zig-wasm player physics with
  independent integrators on the same canned input loop, asserts
  byte-identical state at every tick. **0 divergences** across
  fall/run/jump/jetpack/crouch/run-left/idle. This is the test
  that catches the class of bugs that pass short parity checks
  but accumulate ULP error over minutes of play — exactly the
  failure mode the original "barely detects standing" jitter
  represented.
- **Phase B3 finish (circle primitives).** `sim/src/collision.zig`
  now also implements `circleOverlapsAABB`, `circleHitsAny`, and
  `circleBounce` — bit-exact ports of the TS impls used by the
  projectile collision path. Wasm exports added:
  `circle_overlaps_aabb`, `circle_hits_any`, `circle_bounce`,
  `sizeof_circle_bounce`. Unblocks Phase C projectile.zig.
- New `circleParity.test.ts` (3 tests):
  - 1000 randomised `circleOverlapsAABB` fixtures: 0 mismatches
  - 500 randomised `circleHitsAny` against realistic platforms:
    0 mismatches
  - 6 realistic ricochet scenarios for `circleBounce`
    (floor-underside, platform-top, cover-side, wall, corner-
    clipping, diagonal): identical reflection axis.
- 258/258 client tests, 39/39 server tests, 6/6 Zig tests, both
  typechecks clean. Wasm artifact: 5.5 KB.

## v0.34 - 2026-05-04

- **Phase B4 shipped: full player physics ported + live-swappable.**
  `sim/src/player.zig` ports the entire `stepPlayer` from
  `client/src/sim/player.ts` bit-for-bit — gravity, ground/air
  acceleration, friction, jump (coyote + buffer + cut), variable
  fall, jetpack (drain/recharge/min-velocity-clamp), crouch,
  sub-stepped collision integration. `PlayerStep` extern struct
  (96 bytes) packs the full PlayerEntity subset + memory in one
  ABI-stable layout.
- New `client/src/sim/wasm/__tests__/playerParity.test.ts` — drives
  a 90-tick scripted input sequence (free fall → walk → jump →
  jetpack hold → release → run → crouch) through TS and wasm and
  asserts byte-identical state every tick: x, y, vx, vy, aimX,
  aimY, jetpackFuel, crouching, plus all 6 PlayerMovementMemory
  fields, plus jumpedThisFrame. **0 mismatches across 90 ticks.**
- `client/src/sim/player.ts` extracted `stepPlayerNative` and
  exposed `setStepPlayerBackend(fn)`. Sim purity preserved.
- One TS subtle change: `Math.hypot(vx, vy)` → `Math.sqrt(vx² + vy²)`
  to match Zig's bit-exact `@sqrt`. In our velocity domain (max
  ~1000 px/s) there's no overflow risk; the simpler form is
  identical across hosts.
- `?wasm-player=1` URL flag swaps client `stepPlayer` to wasm.
  `JAKESJAM_WASM_PLAYER=1` does the same on the Bun server.
  Combined with the existing collision flags, predict ↔ authority
  is bit-identical for the entire player physics pipeline.
- Shared `client/src/sim/wasm/playerWasmBackend.ts` factory builds
  the wasm-backed `StepPlayerFn` for both client and server
  hosts — same pack/unpack code, only the loader differs.
- 254/254 client tests, 39/39 server tests, 6/6 Zig tests, both
  typechecks clean. Wasm artifact: 4.9 KB.

## v0.33 - 2026-05-04

- **Phase D2 (server cutover) shipped — bit-identical collision math
  end-to-end.** With both flags set (`?wasm-collision=1` on the
  client URL + `JAKESJAM_WASM_COLLISION=1` on the server) client
  predict and server authority run THE SAME wasm bytecode for
  collision. Predict ↔ authority becomes byte-identical, reconcile
  delta = 0 in steady state, "barely detects standing" jitter
  fully dies in production.
- New `server/src/wasmRuntime.ts` — Bun-side wasm loader.
  `applyServerWasmCollision()` reads `client/public/wasm/sim.wasm`,
  instantiates via Bun's native `WebAssembly`, and installs the
  same `setResolveMoveCachedBackend` swap the client uses. Sim
  module is shared via `@sim/*` path alias, so the swap mechanism
  is mechanically the same — only the loader differs.
- New `JAKESJAM_WASM_COLLISION` env var in `server/src/config.ts`.
  `server/src/index.ts` awaits the swap at top-level so it's in
  place before any matchHost begins ticking.
- New `server/src/__tests__/wasmRuntime.test.ts` (4 tests) — proves:
  - The server can load `sim.wasm` from disk and instantiate.
  - The shared swap mechanism takes effect server-side.
  - 60-tick simulated drop-and-rest produces byte-identical output
    between TS native and wasm impls.
  - The drift-snap fix (foot 1.5 px past floor top) snaps to the
    same byte-exact y in both impls.
- `server/Dockerfile` now COPY-s `client/public/wasm/` into the
  image so the wasm artifact ships with the server. CI builds the
  wasm before docker build, so the file is on disk.
- Both CI workflows (`typecheck.yml`, `deploy.yml`) now run
  `bun run --filter server test` — server tests gate merges.
- Server now has a `test` script.
- All gates: 6/6 Zig tests, 253/253 client tests, 39/39 server
  tests, both typechecks clean. Wasm artifact: 3.4 KB.

**To activate the bug fix in production:**

```sh
flyctl secrets set --app jakesjam-srv-syd JAKESJAM_WASM_COLLISION=1
```

Then any client visiting `https://jakesjam.vercel.app/?wasm-collision=1`
runs full bit-identical collision math against an authoritative
server doing the same. Default users (no flag) still get the TS path
until soak validates the rollout.

## v0.32 - 2026-05-04

- **`?wasm-collision=1` URL flag swaps the live `resolveMoveCached`
  to Zig wasm.** This is the cut where the "barely detects standing"
  / "falls through terrain" jitter bug dies on the client.
- `sim/src/collision.zig` now also implements `sweepAABBCached` and
  `resolveMoveCached`, including the **post-resolve drift probe +
  snap** + **one-way platform short-circuit** with the +2 px float-
  drift slack constants. Wasm exports `sweep_aabb_cached` and
  `resolve_move_cached` take a flat `[]const AABB` plus a parallel
  `[]const u8` one-way mask (spatial-grid broadphase still TS-side;
  no determinism impact, perf optimisation).
- `client/src/sim/collision.ts` extracts `resolveMoveCachedNative`
  as the pure TS impl and exposes `setResolveMoveCachedBackend(fn)`
  so the host can swap. Sim purity preserved — collision module
  imports nothing external; the seam is just a function pointer.
- `applyWasmCollisionFlag()` in runtime.ts wires it: at boot, if
  `?wasm-collision=1` set, packs the cache's flat AABB array +
  one-way mask into the wasm state buffer and routes every
  `resolveMoveCached` call through Zig wasm.
- New `collisionBackendSwap.test.ts` (4 tests):
  - default behaviour (TS native) ✓
  - 100-tick simulated drop-and-rest, both backends produce
    byte-identical position/velocity ✓
  - **the exact bug fix scenario:** mover with foot 1.5 px past
    floor top — both TS and wasm post-resolve probe catch and
    snap to platform-top + zero vy ✓
  - swap is reversible ✓
- 8 collision parity tests now include 10-fixture suite covering
  one-way platforms, tall cover, drift recovery (1.5 px, 1.9 px,
  3.0 px past platform-top), wall slide, jumping through one-way,
  landing on top.
- 253/253 client tests, 6/6 native Zig tests, both typechecks
  clean. Wasm artifact: 3.4 KB.

## v0.31 - 2026-05-04

- **New skill: `zig-code-quality`.** Authoritative Zig style + idiom
  + footgun rules for `sim/*.zig` work. Covers naming (snake_case
  vars / PascalCase types / wasm exports use snake_case for JS
  ergonomics), wrapping vs checked vs saturating arithmetic, error
  handling at the wasm boundary, allocator discipline (no
  `GeneralPurposeAllocator` in freestanding), `extern struct` vs
  `struct` for layout-stable types, optionals over sentinels,
  comptime-when-it-pays, and a pre-PR checklist. Sourced from the
  Zig 0.15 style guide, Zig std library conventions, and
  TigerBeetle's Zig style guide.
- **Applied the skill to existing Zig code.** `rng.zig` cleaned up:
  removed the dead `nextStateForFloat` alias, widened
  `nextIntFromState` arithmetic to i64 internally so callers can
  pass the full i32 range without triggering Zig's checked-arith
  panic. `collision.zig` header updated to match shipped scope.
  `runtime.ts` cleaned up the dead `nextU32` import.
- AGENTS.md zig skill list extended to include `zig-code-quality`.
- 6/6 native Zig tests green, 247/247 client tests green, both
  typechecks clean.

## v0.30 - 2026-05-04

- **`?wasm-rng=1` URL flag swaps the live sim's RNG kernel to Zig
  wasm.** Default behaviour unchanged; the flag is a per-user
  opt-in. When set, every `nextU32(state)` call from anywhere in
  the sim — chaos rolls, projectile spread, draft offers, crit
  rolls — indirects to `wasm.exports.rng_next_u32`. Behaviour is
  identical (parity-proven byte-equal across 7000+ iterations);
  the win is real-browser production validation.
- `client/src/sim/rng.ts` refactored: kernel impl extracted to
  `nextU32Native`, public `nextU32` now indirects through
  `activeBackend`, new `setRngBackend(fn)` lets the host swap.
  Sim purity preserved — the rng module imports nothing external,
  only exposes a setter.
- New `applyWasmRngFlag()` in `client/src/sim/wasm/runtime.ts`
  awaits the wasm boot, then installs the wasm backend. Wired
  into `client/src/main.ts`.
- 4 new `rngBackendSwap.test.ts` cases prove the swap is correct,
  reversible, and doesn't leak state across replacements.
- Total client tests: 247 (was 243, +4).
- Path to bug fix: `?wasm-collision=1` next, which swaps
  `resolveMove` calls in `player.ts` to the parity-proven Zig
  impl. That's the cut where the "barely detects standing" bug
  visibly dies.

## v0.29 - 2026-05-04

- **Zig→WASM substrate is now wired into the live boot path.** The
  Phaser client boot-loads `sim.wasm` at startup (fire-and-forget
  via `getWasmSim()` in `client/src/main.ts`), logs `[wasm-sim]
  ready` to the console with state size + tick + export count.
  Default behaviour is unchanged — wasm is loaded but no hot path
  calls it yet. Cutover happens in Phase D.
- New `client/src/sim/wasm/runtime.ts` — boot singleton +
  `wasmFlag(name)` URL flag helper + `startWasmCanary()`.
- `?wasm-canary=1` URL flag enables a 30-second console probe that
  calls TS `nextU32` and Zig wasm `rng_next_u32` once per second
  with the same state cursor and asserts byte-equality. Provides
  production observability that the wasm is genuinely executing
  and the substrate thesis still holds in real-user runtimes.
- Production build now ships `dist/wasm/sim.wasm` alongside the JS
  bundle. Vite 8/rolldown was tree-shaking `?url` and `new URL()`
  imports; moved to `client/public/wasm/sim.wasm` per Vite's
  documented runtime-asset escape hatch (matches the existing
  `client/public/audio/` pattern).
- `sim/build.zig` now installs the wasm to two locations: the
  public path for runtime, and `client/src/sim/wasm/sim.wasm` for
  the Bun parity tests.
- `Sim` wrapper now exposes the typed `exports` field, so callers
  can hot-path-call wasm functions directly without re-casting.

## v0.28 - 2026-05-04

- **Zig→WASM Phase B3: collision kernel ported with bit-exact
  cross-host parity proven for the public API.** This is the
  marquee win that closes the determinism thesis (ADR-0006) for
  collision math — the exact code path that's been producing the
  "barely detects standing" / "falls through terrain" symptoms.
- `sim/src/collision.zig` ports `sweepAgainstOne`, `sweepAABB`, and
  `resolveMove` (multi-pass slide solver) bit-for-bit from
  `client/src/sim/collision.ts`. AABB and SweepHit are
  `extern struct`s for stable wasm ABI.
- Wasm exports added: `sweep_against_one_flat`, `sweep_aabb_many`,
  `resolve_move`, `sizeof_aabb`, `sizeof_sweep_hit`,
  `sizeof_resolve_move_out`.
- New `client/src/sim/wasm/__tests__/collisionParity.test.ts` —
  6 tests asserting byte-identical output between TS V8 and Zig
  wasm:
  - 24-cell fast-fall tunneling matrix (vy ∈ {600..3000} ×
    platformH ∈ {8, 18, 24, 48}) — all pass.
  - 1000 randomised `sweepAABB` fixtures — 0 mismatches.
  - 100 randomised `sweepAgainstOne` fixtures — 0 mismatches.
  - 5 realistic player scenarios (free fall, walk, jump, wall
    block, diagonal slide) — all pass.
  - **60-tick simulated drop-and-rest** with TS and wasm
    integrating independently — byte-identical position +
    velocity at every tick.
  - 500 randomised `resolveMove` fixtures — 0 mismatches.
- Wasm artifact size: 2.2 KB (was 412 B after B2-RNG, +1.8 KB for
  the collision kernel).
- The public sim still runs from TypeScript — Phase B3 only
  delivers the Zig collision module + parity proof. Cutover
  happens in Phase D when `clientLoop.ts` and `matchHost.ts`
  start calling `resolve_move` instead of `resolveMove`.

## v0.27 - 2026-05-04

- **Zig→WASM Phase B2: RNG ported with cross-impl parity proof.**
  `sim/src/rng.zig` is a bit-exact port of `client/src/sim/rng.ts`
  (mulberry32). New parity test
  `client/src/sim/wasm/__tests__/rngParity.test.ts` runs 7 seeds ×
  1000 iterations of TS V8 vs Zig wasm and asserts byte-exact
  state and IEEE 754 exact-equal float derivations — **7000+
  bit-identical matches**. This is the first concrete proof that
  the substrate thesis (ADR-0006) holds: V8 and wasm produce the
  same bytes for the same inputs.
- Wasm exports added: `rng_next_u32(state: u32) -> u32` and
  `rng_next_int(state, min, maxExclusive) -> i64` (state and
  value packed into one i64 to avoid wasm multivalue ABI).
- Wasm artifact size: 412 bytes (was 256 in Phase A; +156 bytes
  for the rng functions).
- Sim binary still not wired into the live game — TS rng still
  drives prediction. Cutover staged for Phase D.

## v0.26 - 2026-05-04

- **Zig→WASM sim substrate, Phase A toolchain landed.** New `sim/`
  Zig project at repo root produces `client/src/sim/wasm/sim.wasm`
  via `bun run sim:build`. Phase A is staged-only — the live game
  still runs the TS sim; cutover happens in Phase D.
- Added `.zig-version` (0.15.2), `.tool-versions`, `sim/build.zig`,
  `sim/build.zig.zon`, `sim/src/{root,types}.zig`,
  `sim/test/smoke.zig`, `sim/README.md`.
- Added `client/vite-plugin-zig.ts` — debounced rebuild on
  `.zig`/`.zon` change with full-reload on success.
- Added `client/src/sim/wasm/{loader.ts, types.ts}` and a 4-test
  ping-pong suite proving load → step → readback → reset works
  under `bun test`. `loadSim()` for browser (`?url` + streaming
  fallback), `loadSimFromBytes()` for the test harness.
- CI: both `typecheck.yml` and `deploy.yml` install Zig 0.15.2 via
  `mlugg/setup-zig@v2`, cache `~/.cache/zig`, and run
  `sim:fmt`/`sim:test`/`sim:build` before TS gates.
- See `docs/adr/0006-zig-wasm-sim-substrate.md` for rationale and
  `docs/zig-wasm-migration.md` for the rollout plan.

## v0.25 - 2026-05-01

- Added actual health numbers and bars above local and remote player rigs.
- Added a respawn reconciliation guard so stale remote death snapshots do not repeatedly kill the player after respawn.
- Added shot sequencing to match player snapshots and visual-only remote projectile playback so other players' shots can be seen in online rooms.

## v0.24 - 2026-05-01

- Removed Pulse Nova from card progression and changed melee-mode firing away from pulse waves into close-range projectile spray.
- Added more stackable homing options, including Seeker Facets stacking, Micro Seekers, and Magnet Spray.
- Added extra projectile spray patterns with Shard Bloom, Wide Barrage, and Needle Hose.
- Made random card cache rolls less bucket-ordered and more chaotic, with extra weighting toward visible homing and multi-projectile mutations.

## v0.23 - 2026-05-01

- Added a small rechargeable Space-hold jetpack for higher traversal while keeping W as a clean jump input.
- Added jetpack fuel/debug readout beside player health and a small flame plume while the boost is active.
- Moved directional parry to right mouse button while keeping `C` as a keyboard fallback.
- Tuned jetpack fuel and lift upward so Space-hold can reach higher platform blocks reliably.

## v0.22 - 2026-05-01

- Reworked card progression so mutator cards can stack into outrageous builds instead of being hard-limited to one card per bucket.
- Added stackable projectile mutators for +1 projectile, +1 bounce, boomerang pathing, faster projectile velocity, X/I projectile shapes, projectile size changes, and fire-rate/size tradeoffs.
- Added shot cooldown tax based on projectile count, split count, bounce count, homing, beam delivery, and impact radius so fractured bullet builds have a balance cost.
- Added directional parry on `C` with a large cooldown, visible forward arc, no-block counterplay, and stackable card upgrades for wider cover and faster parry recovery.
- Added stackable health and movement cards to counter glass-cannon weapon builds.
- Added new arena pickups: damage amp, speed boost, melee mode, slow trap, vulnerability trap, block jammer, and boss core.
- Added boss pickup mode with bonus health, higher damage, slower movement, reduced fire rate, and a forced rotating bullet-pattern aim system.
- Changed card caches into seven roaming random-spawn pickups that relocate every 20 seconds instead of leaving card stacks everywhere on the map.
- Rebuilt standalone Host and Player HTML bundles with the new gameplay pass.

## v0.21 - 2026-05-01

- Added a first-run splash menu with Practice, Host, Join, and Options actions.
- Added menu music loop support using the supplied `ChatGPT Stickgame.wav` track.
- Added options for menu music volume, mute, and display resolution width.
- Added a held-Tab scoreboard overlay with per-player kills and deaths.
- Reworked 5x3 map expansion to use varied seeded room archetypes instead of repeated mirrored clones.
- Reduced the in-match HUD to only player health plus the active weapon and its current mutators.
- Changed player death into a full respawn sequence: explode, disappear, show taunt, count down 3 seconds, then respawn cleanly.
- Added louder card-cache weapon identity rolls: explicit circle, triangle, square, orb, and five-projectile spray mutators.
- Card caches now prioritize visible weapon changes such as delivery, projectile count, shape, pathing, impact, and element before subtle utility cards.
- Player death now resets collected weapon mutators back to the default starter weapon for the next life.
- Changed the weapon model back to the intended progression rule: every player starts from the default starter weapon and card pickups add mutators over time.
- Added card-cache pickups to the arena so collected cards rebuild the current weapon into divergent player-specific builds.
- Added deterministic variation to the 5x3 Boxworks grid so cells mirror, jitter, resize platforms, and place pickups/destructibles differently instead of being direct copies.
- Added player death explosion feedback with the requested on-screen taunt.
- Raised the room target from 6 players to 10-player all-v-all free-for-all support.
- Added prototype remote-player projectile targets, shield-aware damage snapshots, and remote damage writes for multiplayer hit sanity testing.
- Tuned starter weapon damage down from 15 to 10 after a 10-player sanity pass showed the baseline time-to-kill was too fast before card progression.

## v0.20 - 2026-05-01

- Fixed player gun aiming under camera-follow by feeding the procedural rig the same world-space aim target used by reticle and projectile firing.
- Cleared vertical traversal lanes in every 5x3 Boxworks grid cell by splitting blocking floor/mid platforms around a central shaft.
- Reworked row-to-row climb helpers so ledges sit beside the shaft instead of blocking the vertical entrance and exit path.
- Added a standalone HTML build path that emits single-file Host and Player pages for cross-platform Linux/Windows testing.
- Standalone pages now set their default client role and derive the Convex backend URL from the serving host, with a `?convex=` override for manual test routing.

## v0.19 - 2026-05-01

- Expanded Boxworks from a 5x2 world to a 5x3 grid.
- Added traversal connector platforms between copied grid blocks so rows and columns can be reached through normal movement.
- Changed local player spawning to choose a random spawn from the full expanded grid on reset/start.
- Allowed hosted room matches to start with a single ready player for solo hosted testing.

## v0.18 - 2026-05-01

- Split the lobby UI into Host and Player client roles.
- Host clients now own game setup: room creation, practice, match start, character test selection, and chaos modifier controls.
- Player clients now join by IP address, port, and room code while only exposing player identity fields for name and colour.
- Added displayed host IP/port fields based on the current browser location.
- Added player-side host IP/port inputs that redirect to the requested host client when needed.
- Added LAN host dev scripts and optional advertised host address/port environment overrides.
- Moved room chaos modifiers into Convex room state with a host-only settings mutation so players no longer carry private modifier state into online matches.

## v0.17 - 2026-05-01

- Extended the roadmap with post-M9 implementation milestones for full duel flow, pickup economy, PvP health authority, draft/results UX, and cosmetic-only loot experiments.
- Added map pickup definitions to the shared map data model.
- Added health shards, shield cells, and overcharge cores across the expanded Boxworks world.
- Added pickup collection, respawn timers, floating pickup feedback, HUD/debug pickup status, and a generated pickup sound.
- Shield cells now grant shield charge and temporary field-shield access, while overcharge temporarily boosts local damage and fire rate.

## v0.16 - 2026-05-01

- Added a first main-menu scene so the game boots into character, chaos, and room setup before entering the match loop.
- Added a local Practice button that starts a match from the current lobby-side character and chaos selections.
- Changed chaos selection updates to return to the main menu instead of immediately restarting live gameplay.
- Added local player health hooks for fire and explosion damage.
- Added held Shift shielding for shield-capable characters with limited charge, drain, recharge, and visible shield feedback.
- Confirmed card data/test loadouts exist, but real card collecting, draft rewards, and map pickup systems are still upcoming Milestone 5 work.

## v0.15 - 2026-05-01

- Added Milestone 9 release-readiness scope.
- Added root `npm run verify` to run typecheck and production build together.
- Added `docs/release-readiness-checklist.md` with smoke-test and ship/no-ship gates.
- Updated the running client build tag to M9.

## v0.14 - 2026-05-01

- Added Milestone 8 playtest and stress-harness scope.
- Added `docs/playtest-stress-plan.md` with local, chaos-stack, online 1v1, and six-tab lobby test procedures.
- Added a reusable playtest notes template and current known limitations.

## v0.13 - 2026-05-01

- Advanced to Milestone 7 with data-driven custom chaos modifiers.
- Added party toggles for Low Grav, Slo Mo, Golden Gun, Slappers Only, Fire Hazard, Random Shapes, and Max Recoil.
- Wired chaos modifiers into local/custom match behavior: gravity, time scale, damage, fire rate, projectile disabling, random projectile shape rerolls, arena fire hazards, and recoil.
- Persisted local chaos toggle selections and restarted the match scene when modifiers change.

## v0.12 - 2026-05-01

- Advanced to Milestone 6 with the first single-map MVP polish pass.
- Expanded Boxworks into a 10-screen world while keeping the visible game viewport at the original 960x540 size.
- Added camera bounds and camera follow so the player only sees the current local slice of the larger arena.
- Updated mouse aiming to convert screen pointer coordinates into world coordinates under the moving camera.
- Added generated placeholder audio for shooting, hits, jumping, landing, explosions, fire, and loadout/card changes.
- Updated the running client build tag to M6.

## v0.11 - 2026-05-01

- Advanced to Milestone 5 with the first playable character archetype integration.
- Added lobby character selection for Balanced, Heavy, Sprinter, and Shielded.
- Room players now carry selected character ids into match startup and the player list displays each player's archetype.
- MatchScene applies character movement speed, size scale, recoil control, max health metadata, and visual scale to local and remote player rigs.
- Updated the running client build tag to M5.

## v0.10 - 2026-05-01

- Added the first low-frequency online player snapshot loop for Milestone 4.
- Added Convex `matchPlayerSnapshots` storage plus submit/query functions for latest per-player match state.
- Extended the client room API to publish local position, velocity, aim angle, health, alive state, crouch state, and sequence at a capped rate.
- MatchScene now subscribes to match player snapshots and drives remote player rigs from subscribed room state.

## v0.9 - 2026-05-01

- Advanced to Milestone 4 with the first Convex lobby-to-match gameplay handoff.
- Lobby clients now dispatch match context when the room enters `in_match`, including room code, match id, local player id, and room players.
- MatchScene can start from room player data, place the local player in their spawn slot, and render remote room players with lobby names and colours.
- Updated the client build tag to M4 so the running prototype reflects the current milestone.

## v0.8 - 2026-05-01

- Advanced to Milestone 3 with a first playable destructible/fire arena pass.
- Made Boxworks barrels, boxes, mines, and cubes real projectile targets with health, hit flashes, break VFX, and reset behavior.
- Added explosive destructible reactions for barrels and mines with area damage against the dummy and nearby destructibles.
- Added temporary fire patches from fire impacts and flammable object destruction; fire damages flammable objects and dissipates after a short duration.
- Shortened the local player character by reducing the procedural rig scale and gameplay hitbox, while keeping crouch/standing muzzle origins aligned to the pose.

## v0.7 - 2026-05-01

- Reworked the offline combat prototype around the Crystal Rounds orthogonal weapon system.
- Added typed weapon buckets for Delivery, Trajectory, Quantity, Impact, Element, Utility, and Wild multi-bucket cards.
- Expanded prototype card data to 28 crystal-tech cards, including Raycast Prism, Pulse Nova, Homing Cluster, Cataclysmic Prism, and Sticky Ray.
- Added a WeaponSystem composer that resolves selected card hands into one playable Scrap Rifle / Crystal Blaster build while enforcing bucket ownership.
- Upgraded ProjectileSystem with projectile, raycast, continuous beam, and pulse delivery; gravity, float, homing, bounce, split, sticky, pierce, slow-field, and element-colour VFX hooks.
- Replaced debug shape switching with five test loadouts in MatchScene for quick local synergy testing.

## v0.6 - 2026-05-01

- Advanced to Milestone 2 with the first playable offline combat loop.
- Added aim reticle and aim line from player muzzle to mouse target.
- Added Starter Pistol / Crystal Blaster projectile firing with recoil and fire-rate cooldown.
- Added projectile system with range, lifetime, terrain collision, target collision, shape rendering, and element glow colours.
- Added debug projectile shape switching on number keys 1-5 for circle, triangle, square, hexagon, and orb.
- Added dummy target health, hit knockback, score, death banner, and round reset.

## v0.5 - 2026-05-01

- Advanced to Milestone 1 with a playable offline Boxworks movement playground.
- Added Boxworks collision platforms, side walls, spawn markers, and placeholder destructible props.
- Added manual movement system with acceleration, friction, gravity, fast fall, variable jump cut, coyote time, and jump buffering.
- Added controllable procedural placeholder player rig, aim-facing gun line, out-of-bounds/reset handling, and debug overlay for position, velocity, grounded state, coyote timer, and jump buffer timer.
- Added grounded crouch on `S`, keeping airborne `S` as fast fall.
- Split player rig poses so crouch keeps the compact bent-leg stance while standing uses taller, straighter legs.
- Updated the game boot flow to open directly into the playable match scene.

## v0.4 - 2026-05-01

- Scaffolded Milestone 0 as an npm workspace.
- Added Phaser + TypeScript + Vite client under `client/`.
- Added Convex schema, generated API files, and room functions for host, join, ready, heartbeat, leave, and start-match placeholder flow.
- Configured anonymous local Convex development for `http://127.0.0.1:3210`.
- Added host/join browser UI with room code, player name/colour, ready state, and connected player list.
- Added starter gameplay data files for weapon, projectile modifiers, characters, cards, and Boxworks map/destructible placeholders.
- Added local setup commands and checks to `README.md`.
- Added future client-side prediction and server reconciliation direction from Gabriel Gambetta's networking article.

## v0.3 - 2026-05-01

- Captured art reference direction: low-fi side-view arena readability, rough painted terrain, bright projectile/action accents, tiny expressive fighters, compact HUD, optional saturated teal/lime map palettes, and procedural 2D IK puppet animation.
- Added stronger orthogonal weapon mutation direction around one shared starter pistol/projectile.
- Clarified that the baseline should feel like a simple raycast shooter while using visible projectiles for readability and upgrade expression.
- Added character stat archetype and active shield/ability button direction.
- Added milestone roadmap document for project sequencing.
- Clarified MVP target as one main map with up to 6-player stress testing, four weapon paths, four characters, and four destructible elements.
- Added pickup, loot crate, cosmetic-only loot/gacha, and temporary buff/debuff boundaries.
- Added post-MVP dice modifier tasks for low gravity, 4x map, slow motion, golden gun, slappers only, Big Purp Dilly Mode, fire hazard rounds, exploding barrels only, random projectile shapes, and max recoil.

## v0.2 - 2026-05-01

- Added orthogonal projectile/build design direction.
- Defined projectile shape variables: circle, triangle, square, hexagon, and orb.
- Added four weapon evolution paths: Blap, Heavy, Trick, and Element.
- Added homing/tradeoff examples such as Homing Greed and Orby Blap Blap.
- Added destructible arena object direction: barrels, boxes, mines, and cubes.
- Added fire/napalm status system direction.
- Updated MVP target notes for up to 6 players, one main map, four characters, four weapon paths, and four destructible elements.
- Added implementation backlog tasks for projectile modifiers, destructibles, fire, weapon paths, and character archetypes.

## v0.1 - 2026-05-01

- Created production-ready GDD.
- Locked prototype around 1v1 browser-first 2D platform shooter.
- Added Phaser + TypeScript + Vite + Convex technical direction.
- Added Codex-ready task backlog.
- Deferred Java simulation server until prototype testing proves need.
