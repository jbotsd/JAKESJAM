# JAKESJAM — Playtest & QA

A pre-flight + regression checklist for the post-pivot build (rogue-lite progression, always-on FFA, per-round chaos, deterministic shared sim under `client/src/sim/`). For the broader playtest plan see `docs/playtest-stress-plan.md`; for the ship/no-ship gate see `docs/release-readiness-checklist.md`. This is the everyday "did I break something" pass.

## Smoke check matrix (single client)

Run after every meaningful change. Under two minutes.

- [ ] `npm run verify` passes (typecheck + build).
- [ ] `bun test` from `client/src/sim/__tests__/` green (round, collision, weaponBuild, world-determinism, chaos, combat, destructible, fire, pickup, rng).
- [ ] Client boots, no red console errors.
- [ ] Lobby loads, spawn into live FFA via always-on path.
- [ ] Player spawns at a valid position (not inside terrain, not OOB).
- [ ] Movement: A/D run, W/Space jump, S crouch, Space-hold jetpack (visible flame + fuel readout).
- [ ] LMB → projectile spawns, travels, collides, despawns.
- [ ] Take a hit → health drops on the rig readout.
- [ ] Die → death VFX + respawn countdown + draft-on-death overlay.
- [ ] Pick a card → applies on respawn, weapon visibly changes.
- [ ] 30s idle after spawn → no console errors, no memory churn warnings.

## Online smoke check (two windows or two machines)

- [ ] Both clients connect to the same always-on server and see each other's rig.
- [ ] Local movement is predicted; remote is smoothed (~100ms behind).
- [ ] Projectiles render symmetrically within one frame on both windows.
- [ ] First-blood wager: first hit triggers a speed buff on the buffed player only.
- [ ] Death is mirrored within one snapshot.
- [ ] Per-round chaos: round 2+ rolled modifier matches on both clients.
- [ ] Sudden death: both at `targetScore-1` triggers arena shrink on both.
- [ ] Pity boss: a 0–3 player gets boss buff next round, visible to both.
- [ ] Disconnect mid-round → opponent sees grace state, not instant despawn.
- [ ] Reconnect → predicted state resyncs within ~1s, no permadeath.
- [ ] Round-end and match-end events propagate to both clients.

## Regression areas (when you change X, verify Y)

- **`sim/projectile.ts`** → bounce bounces, homing turns toward enemy, anti-homing turns away, sticky lingers + detonates on fuse, pierce-chain decrements per hit, explosive AoE damages within `EXPLOSION_RADIUS`, gravity arcs, float oscillates, splits spawn `splitCount` shards on expire.
- **`sim/collision.ts`** → swept-AABB corner hit lands at `t<1`, slide on both axes, two-axis corner does not tunnel, projectile-vs-platform respects expanded radius.
- **`sim/round.ts`** → countdown → fighting → round-over fires the right `SimEvent`s, time-out resolves to highest-health alive player, mutual KO returns null winner, match terminates at `TARGET_SCORE_DEFAULT`.
- **`sim/data/weaponBuild.ts`** → applying a card doesn't lose previous mutators, `clampBuild` enforces caps, bucket exclusivity holds for non-Wild cards, Wild cards occupy two buckets.
- **`sim/data/chaosModifiers.ts`** → `getChaosProfile([])` returns `NEUTRAL_CHAOS_PROFILE`, multiple modifiers compose multiplicatively for numerics + OR for booleans, `fire-hazard` interval picks the min.
- **`sim/combat.ts`** → parry arc detects only forward-cone hits, cooldown gates retries, shield drains on hit and recharges on disengage.
- **`sim/pickup.ts`** → arena pickups stripped; post-death card draft offer is the live path. Verify draft offers come up on death and selection persists.
- **`sim/destructible.ts` / `sim/fire.ts`** → barrels explode dealing AoE, flammable destructibles spawn fire patches, patches deal `FIRE_PATCH_DEFAULT_DPS` and expire after `FIRE_PATCH_DEFAULT_LIFETIME_MS`.
- **`MatchScene.ts` / `OnlineMatchScene.ts`** → both render the same `WorldState`. Regressions on one path likely exist on the other; check both.

## Balance dials

Tune in tiny increments.

| Dial | Current | Range | Where |
|---|---|---|---|
| Starter pistol cooldown | 180ms | 100–300ms | `sim/data/weapons.ts` |
| Starter damage | 10 | 8–18 | `sim/data/weapons.ts` |
| Parry active window | `PARRY_ACTIVE_MS` | 100–250ms | `sim/combat.ts` |
| Parry cooldown | 1800ms | 1000–4000ms | `sim/combat.ts` |
| Draft offer count | 3 | 2–5 | `sim/pickup.ts` |
| Round time limit | 90s | 30–120s | `sim/round.ts` (`ROUND_TIME_LIMIT_MS`) |
| Round-over hold | 2500ms | 1500–4000ms | `sim/round.ts` (`ROUND_OVER_HOLD_MS`) |
| Match target score | 3 | 3–7 | `sim/round.ts` (`TARGET_SCORE_DEFAULT`) |
| Sudden-death arena scale | 1.0 → 0.6 | endpoint 0.5–0.7 | shrink interpolation |
| Per-round chaos pool, round 1 | empty (baseline) | locked | always |
| Per-round chaos pool, round 2+ | full 7-modifier pool | curate per playtest | `sim/data/chaosModifiers.ts` |
| Snapshot rate | 60Hz | 30–60Hz | `sim/constants.ts` (`SNAPSHOT_HZ`) |
| Jetpack fuel | `JETPACK_MAX_FUEL` | tune for ~3s sustained | `sim/player.ts` |
| First-blood speed buff | TBD | +15–35% for round | speed-buff system |
| Pity boss HP multiplier | TBD | 1.5×–2.5× | pity boss buff |

## Stress tests

- **10-player FFA in a window-pair.** Watch for snapshot bandwidth blow-up (no AOI culling, `perf-blockers.md` #6), projectile cap saturation, parry/shield contention, visual mess.
- **Sustained uptime.** Leave a Bun server running 4+ hours with idle clients reconnecting periodically. Watch for setInterval drift (`perf-blockers.md` #15), Convex write creep, leaks in per-match `World` instances.
- **Chaos-stack soak.** Worst combo (Slappers + Fire Hazard + Random Shapes + Max Recoil) for ten rounds. Confirm no determinism desyncs, no projectile pool exhaustion, no unrenderable VFX explosion.
- **Reconnect storm.** One client closes/reopens every 5s for two minutes. Grace window holds, reconnect path is idempotent, no orphaned PlayerEntity stays.

## Known unstable surfaces

- **`MatchScene.ts` god-class** — still ~3,000 lines after cleanup. Cross-cutting features land here. Touching it has unpredictable blast radius. Prefer extracting into the sim or a sibling renderer.
- **Two parallel scene paths** — `MatchScene.ts` and `OnlineMatchScene.ts` co-exist during the always-on transition (`perf-blockers.md` #1, #14). A change to one usually needs to land in the other.
- **Sim ↔ render boundary** — `Date.now()`, `Math.random()`, or Phaser inside `sim/` is a bug (`dev-stream-sim.md` Hard Rules). Lint or grep before merge.
- **Determinism drift** — if `world-determinism.test.ts` flakes, prediction desyncs silently in playtest. Load-bearing test.
- **Reconnect grace + respawn race** — "stale remote death snapshot kills you after respawn" class (changelog v0.25). Re-test on every netcode change.
- **Convex boundary creep** — Convex is lobby/match-state/results only. Any per-frame or per-tick write to Convex is wrong.
- **Chaos modifier composition edge cases** — `slappers-only` disables projectiles entirely; verify Golden Gun and Random Shapes degrade gracefully when stacked with it.
- **Card stacking caps** — `clampBuild` is the last line between fun-broken and unreadable-broken. Test stacked builds at round 8+.
