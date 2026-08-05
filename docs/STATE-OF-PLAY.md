# STATE OF PLAY — the one honest screen

*The single answer to "what is this game right now and what needs
finishing." Updated in the same commit as the change that dates it —
if a claim here is stale, fixing it is part of the offending commit's
cleanup, not a separate chore. Last touched: 2026-08-05.*

## What is LIVE (play.elyad.io)

- **Self-hosted stack:** one Bun process (`server/src/index.ts`) serves the
  built client + game server on :8088, exposed via the named Cloudflare
  tunnel (`jakesjam` → play.elyad.io). Runs as the transient user unit
  `jakesjam-host.service` — restart with
  `systemctl --user restart jakesjam-host.service`. **No npm. No Convex
  backend** (an optional match-lifecycle client exists behind
  `CONVEX_URL`, unset in prod). Vite build via `bun run build`; a SIM
  change (client/src/sim/\*, sim/src/\*.zig) additionally needs the server
  restarted — rebuild alone looks dead (docs/hosting-elyad-io.md).
- **The Venue:** lobby→arena public flow (venue-goal.md) — walkable lobby,
  bell admission, no mid-fight spawns, elastic bots (all 4 classes,
  melee-aware AI), clips + replays, funnel/email gate.
- **Four real classes:** Geometrician / Kindled / Interstice / Syzygist —
  full 10-ability catalogs each, class base weapons (Geometrician
  projectile bolt as of 2026-07-23, Interstice hitscan + melee, Syzygist
  homing fire-tendrils, Kindled Edge melee), and — as of 2026-07-23 —
  **enforced chassis stats** (health 100/125/85/100, speed, recoil
  control, flagged hitbox scale; `chassisStatsForArchetype` is the single
  source of truth, cohesion-goal.md P1).
- **Cards:** ~65-card universal pool (split-spam purged 2026-07-18,
  physics-verb variety in), Emission engine (E to cast), Six Axes ability
  cards on keys 1–4 (six-axes-goal.md Phases 0–3), escalation draft at
  round end.
- **Sim architecture:** TS-authoritative combat/weapons/events; Zig/wasm
  runs movement physics + rng/collision (bit-parity, `zig build` with
  0.15.2); wasm world-step exists behind `USE_WASM_STEP_WORLD=1` (off in
  prod).

## The active goal docs (in priority order)

*(2026-08-05: the live orchestration doc is now **gospel-goal.md**, with
**open-doors-goal.md** as its Track D detail — the list below is the
2026-07-23 snapshot, kept for the acceptance criteria it points at.)*

1. **convergence-goal.md** — the one-big-/goal orchestration contract
   (2026-07-23): Zig-first suite + cohesion P2/P3/P4 as parallel tracks,
   built for ultracode workflow fan-out. Its Status block is the tracker
   for those tracks.
2. **cohesion-goal.md** — P1/P5 DONE; P2/P3/P4 execution now orchestrated
   under convergence-goal.md (acceptance criteria still live here).
3. **six-axes-goal.md** — complete except Phase 4 (Jake's live playtest).
4. **venue-goal.md** — shipped through its pillars; reference for venue
   behavior.

## What needs finishing (live pointer)

See **gospel-goal.md § Status** (and open-doors-goal.md's STATUS for
Track D) — those blocks are maintained commit-by-commit; cohesion-goal's
tracks closed with convergence-goal. Standing AWAITING-JAKE rows: P1.7
chassis feel-check, P2.5 voice-pass sign-off, Syzygist color-slot call,
Six Axes Phase 4 playtest.

## Parked / deferred (deliberate, not forgotten)

- Fight Night show overlay (own goal doc when its time comes).
- Duos queue as Syzygist's peak (classes-goal.md) — venue ships FFA today.
- Wasm world-step parity for the six-axes/chassis TS-side folds (recorded
  beside the existing B2 gap).
- Web portals — **DROPPED, not parked** (2026-08-01 decision): the
  CrazyGames SDK integration was deleted from the client (10b359e,
  2026-08-05) and no Poki submission will follow. The launch strategy is
  the **Fight Night email-gate funnel** (open-doors-goal.md; outreach
  material banked in `marketing/`, on hold by Jake's order). The email
  gate stays.

## Where history lives

`docs/archive/` (stale-era docs with banners), `docs/changelog.md`,
git log — never this file.
