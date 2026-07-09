# JAKESJAM — Performance & Architecture Blockers

> **Mostly RESOLVED (status check 2026-07-09):** this audit predates the
> netcode cutover and most Tier S/A items have since shipped — the scene
> split landed (MatchScene is the no-enemy practice zone; OnlineMatchScene
> is the game), the sim has full test coverage (669 client + 143 server
> tests), snapshot DELTA encoding + AOI interest grids exist
> (snapshotDelta.ts, InterestGrid.ts), and the legacy per-frame Convex sync
> is env-gated off. Kept for the still-open items and as the origin of the
> per-tick scratch-buffer discipline (see World.ts runtime scratch +
> bench/simTick.bench.ts). Current ground truth: CLAUDE.md.

Snapshot-in-time audit of the biggest things slowing the project down or capping its ceiling. Sorted by **impact ÷ effort**. The top of this list is "fix today, get massive return"; the bottom is "ship without it, revisit if it bites."

## Tier S — Massive blockers, fix now

### 1. Two parallel render/auth paths (`MatchScene` vs `OnlineMatchScene`)

`MatchScene.ts` is **3,206 lines** and runs the offline + Convex-per-frame-snapshot path. `OnlineMatchScene.ts` is **227 lines** and runs the new sim+netcode path. Most gameplay (parry, jetpack, shield, fire, destructibles, pickups, chaos modifiers, card draft overlay, HUD, audio) lives ONLY in the old MatchScene. Players on `?netcode=new` get a barebones experience.

**Cost:** every gameplay polish you ship has to be ported once you cut over. Right now you're effectively maintaining two games.

**Fix path:** finish the cutover. Move shield/parry/jetpack/destructibles/fire/pickups into `sim/`, then make OnlineMatchScene mount the existing render systems against `WorldState`. Or: kill OnlineMatchScene and add the new netcode transport into MatchScene as the sync layer (replacing per-frame Convex). Pick one.

**Estimated effort:** 1–2 days of focused work. Single biggest leverage move on this list.

### 2. `ProjectileSystem.ts` (983 lines) and `MatchScene.ts` (3,206 lines) are god-classes

Anything you change in either has unknown blast radius. Tests don't exist (next item). Adding a new card/mutator/weapon means scrolling through 4,000+ lines.

**Fix path:** as part of #1, extract `MatchRenderer`, `MatchInput`, `MatchAudio`, `MatchHud` from MatchScene. Sim already owns the simulation half; rendering should be similarly split. ProjectileSystem should split into `ProjectileSpawner`, `ProjectileMotion`, `ProjectileCollider`, `ProjectileVfx` — each <300 lines.

**Estimated effort:** 4–6 hours, mechanical. Pure refactor, no behavior change.

### 3. Zero test coverage anywhere

Sim is pure → trivially testable. Round flow (`stepRound`), collision (`sweepAABB`, `resolveMove`), weapon resolution (`createWeaponBuild`), projectile lifecycle, RNG determinism — all testable in 50 lines each. Today: a snapshot-mismatch bug between client prediction and server authority would only show up as visual glitching during playtest.

**Fix path:** wire `bun test` for `sim/`, write `round.test.ts`, `collision.test.ts`, `weaponBuild.test.ts`, `determinism.test.ts`. Add one CI step that runs them.

**Estimated effort:** 30 min for the runner + 2 hours for the first 5 tests. Then every future change has a safety net.

### 4. `matchPlayerSnapshots` table + `applyPlayerDamage` mutation (legacy Convex sync)

These are wasted writes on every match — old MatchScene still uses them, but they're dead weight once the cutover lands. Each frame snapshot = one Convex DB write per player at ~10Hz × 10 players = 100 writes/sec/match. At Convex's free tier (1M function calls/mo), that's 3 hours of one match per day before you exceed it.

**Fix path:** part of cutover — drop the table + mutations after #1.

**Estimated effort:** ten minutes once #1 is done.

## Tier A — Big wins, do this week

### 5. Full snapshot every tick (no delta encoding)

`Snapshot.state` is the entire `WorldState`. At 60 Hz × 10 players × 100+ projectiles = ~50 KB/s/client which is fine, but it scales with entity count. The protocol has `baseline: Tick | null` reserved for delta encoding; nothing fills it.

**Fix path:** server keeps a per-client baseline ring (last 8 acked snapshots). On send, diff `state` against `state[baseline]` and send only changed fields. Standard implementation: ~100 lines in `deltaCodec.ts`, used by both `matchHost.ts` (encode) and `clientLoop.ts` (decode).

**Estimated effort:** 1 day to implement + tune. Not urgent at jam scale.

### 6. No AOI (area-of-interest) culling

Every client receives every projectile and player even when they're 2,000 px away. agar.io / surviv.io / krunker.io all cull aggressively. You don't need it at 1v1 jam scale, but the moment you do 10-player on a 5×3 expanded map, bandwidth scales O(players × entities).

**Fix path:** in `matchHost.ts:broadcastSnapshot`, filter `state.players` and `state.projectiles` per-client to only entities within ~1.5 viewports of that client's player. ~50 lines, gated by a `cullDistance` constant.

**Estimated effort:** 2 hours.

### 7. No reconnect / resume on disconnect

(Agent D is fixing this now — preserves player state for 10s on disconnect, exponential-backoff reconnect on client.)

### 8. No lag compensation on shots

(Agent B is fixing this — server rewinds opponent positions by client RTT/2 when validating fire inputs.)

### 9. No reconciliation smoothing

(Agent A is fixing this — smooths the local player render across snapshot deltas instead of hard-snapping.)

### 10. No real-time net stats visibility

(Agent C is fixing this — RTT/snap-rate/predict-delta HUD toggleable in-game.)

## Tier B — Worth doing, not urgent

### 11. `convex/matchmaker.ts` hardcodes 3 Fly URLs (`syd`, `sjc`, `fra`); only `syd` exists

A user whose lobby asks for `sjc` gets handed a URL that doesn't resolve. Currently nothing in the lobby UI even lets them pick a region — defaults to syd silently.

**Fix:** drop `sjc` and `fra` from `GAME_SERVERS` until they're actually deployed, OR add health checks that fall back to syd.

### 12. Player identity = `crypto.randomUUID()` in localStorage

Two browser tabs on same machine = same playerId = both clients race-condition each other in any room. Fine for now, broken when you want sessions across devices.

**Fix:** generate a per-tab session id on top of the player id, OR move to Convex Auth (anonymous initially).

### 13. `package-lock.json` was the canonical lockfile until today; toolchain inconsistency

(Fixed in this commit chain — Bun-only now, `bun.lock` checked in.)

### 14. `MatchScene` god-class growing every commit

Recent additions (jetpack, parry, scoreboard, splash music, card draft on death) all land inside MatchScene because that's where the gameplay is. Every commit makes #1 worse. The longer the cutover waits, the bigger the surface area.

### 15. Snapshot timing drift on the server

`setInterval(() => tick(), STEP_MS)` drifts when the JS timer queue gets delayed. Over a 30-second match, ticks can drift by 100s of ms. Doesn't matter for correctness (sim is fixed-step) but does matter for snapshot-rate stability.

**Fix:** accumulator-based loop (`while (now - lastTick >= STEP_MS) { tick(); lastTick += STEP_MS; }`).

### 16. No spectator path

Convex matchmaker mints tokens only for players in `roomPlayers`. Spectators (streaming, casters, post-match review) have no entry. Defer until needed.

### 17. Standalone HTML build path is rotting

`tools/build-standalone.mjs` + `standalone/JAKESJAM-host.html` + `standalone/JAKESJAM-player.html` haven't been regenerated since the lobby refactor. They embed an old client behavior.

**Fix:** delete unless you actually want LAN-without-internet support.

## Tier C — Won't matter at jam scale

### 18. No anti-cheat baseline

Server doesn't validate input dt, position teleports, fire-rate beyond cooldown. Trivial to write a client that fires 1000 shots/second. Doesn't matter for friends-only playtest.

### 19. WebSocket compression off

`perMessageDeflate: false` is correct for hot-loop binary tiny frames. Leave it.

### 20. Client bundle is 1.58 MB / 415 KB gzipped

Phaser is most of it. Code-splitting would help but isn't urgent.

### 21. No metrics / observability on the Bun server

Add a `/metrics` Prometheus endpoint when you actually run multiple regions. Today, console.log is fine.

## Top-of-mind recommendation

If I had **one day of focused work**, I'd spend it on **#1 (cutover) + #2 (split god-classes)**. They unlock everything else: tests become possible, AOI/delta become surgical instead of painful, the legacy Convex path dies cleanly, and every future gameplay feature ships once instead of twice.

If I had **one hour**, I'd spend it on **#3 (test runner + 5 sim tests)**. Lowest absolute effort, highest dividend on every subsequent change.

The 4 in-flight agents (#7–#10) are improving the netcode internals but won't replace the structural work in #1–#3.
