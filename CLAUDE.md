# JAKESJAM — session ground truth

This file wins over anything stale in `docs/` or code comments. Several
docs describe plans that were later reverted or superseded — when a doc
contradicts this file, trust this file, then verify against the running
code. Last verified: 2026-07-08.

## What actually runs in production (verified, not aspirational)

- **Sim authority is TypeScript.** `client/src/sim/World.ts`'s
  `stepWithRuntime` runs on the server as authority and on the client as
  prediction. A full-Zig orchestrator (`sim/src/world.zig`) exists but its
  cutover was **reverted** — it's opt-in via `USE_WASM_STEP_WORLD=1`
  (server env, unset in the live deployment; check
  `/proc/<pid>/environ` of the running server if in doubt) and
  `?wasm-world` URL flags (client). Ignore any doc claiming "FULL ZIG
  drives every tick" — that was true for ~a day in May 2026 and was rolled
  back.
- **Only the swap modules run in wasm by default**: rng, collision, and
  player movement physics (`stepPlayer`), plus the shared trig LUT.
  Consequence: **changes to player movement physics must be mirrored**
  between `client/src/sim/player.ts` and `sim/src/player.zig`, then
  `cd sim && zig build` (Zig 0.15.2, mise-pinned). **Changes to weapon /
  combat / round / draft logic are TS-only** — no Zig mirror needed; they
  ship the moment the server restarts.
- **Deployment is a self-contained Bun host** (`bun run host:public`):
  one process serves `client/dist` statics AND the authoritative game
  server on :8088, exposed via Tailscale Funnel (stable URL). No Vercel,
  no Fly, no Convex required. Convex code still exists but is env-gated
  (`CONVEX_URL` unset = disabled, which is the live state).
- **Deploy rules**: client-only change → `bun run build` + browser
  refresh (server serves dist per-request). Sim change → rebuild AND
  restart the :8088 server (it loads sim modules once at boot; a rebuild
  alone looks dead because prediction gets reconciled away).

## Cards / data pipeline

`client/src/sim/data/cards.ts` is the single source of truth →
`bun run gen:cards` regenerates `sim/src/data/cards_gen.zig` →
`cd sim && zig build`. Run both after ANY card or base-weapon change.

## Current controls / mechanics (differs from older docs)

- **Right-click (or C) = the aegis power-slide**: aim-directional dash
  that blocks/reflects in a 120° front arc on the way in, bashes on
  contact, with recovery endlag after the burst. It **replaced the timed
  parry** — `tryStartParry` is human-unreachable (bots still use it): the
  sim's Ability edge casts at full charge and falls through to the parry
  below full, but the CLIENT only sends the Ability bit at full predicted
  charge (OnlineMatchScene input assembly + TouchControls arm gate), so
  humans can only ever reach the cast.
- **E (or the EMIT touch button) = the Emission cast** — only lit/armed at
  full charge; see the Emission bullet below.
- **Keys 1-4 (touch: numbered buttons) = drafted actives**
  (`docs/six-axes-goal.md` Layer 2): ability CARDS drafted through the
  normal round-end picker land on the action bar in pick order, cooldown-
  gated, input bits 10..13, server-validated (`ability-activated` events).
  Max 4 held — the offer roll stops offering ability cards at a full hand.
  Kill-switch: `ABILITIES=off` (server env) strips bits 10..13 at
  `matchHost.applyInput`, same lever shape as `EMISSIONS=off`.
- Shift = held shield. Left-click = alternating-hand shuriken throws.
- Jetpack: **removed** (fuel field pinned for ABI stability only).
  Magazine/reload: **data-only, deliberately unenforced** (explicit
  design decision 2026-07-08 — do not "fix" this by implementing reload).
- **Drafts are universal round-end** (Escalation Engine —
  `docs/escalation-engine-goal.md`): every roster player including the
  **round winner** receives offers; catch-up is **richer sampling weights**
  for non-winners (`draftWeights.ts`), never winner silence. Draws: all
  draft at standard weights. `maxStacks` / `unique` enforced at the offer
  roll. Death is **not** the picker primary loop.
- **Ability = the Emission** (Emission Engine —
  `docs/emission-engine-goal.md`): COMPOSED from the card hand, never
  picked from a menu. `abilityCharge` (0–100, already wire-synced +
  hash-mixed) fills from damage dealt/taken; `InputBit.Ability` (1<<7)
  casts at full charge, server-authoritative; damage budget below a kill.
  Ability-space is **six orthogonal axes** (Drain / Ward / Stride /
  Sorcery / Mystery / Technique) that stack and never cancel — axis
  membership derives from modifier fields, not hand-tags. Zig receives
  parameters via the `player_fire_config` pattern, never per-ability
  behavior.

## Testing / tooling

- Bun for everything (`bun test`, `bun run build`, `bunx`) — never
  npm/npx/yarn/node. Full client suite + wasm parity: `cd client && bun
  test`. Server suite: `cd server && bun test`.
- Determinism rules when touching sim code: use `lutCos/lutSin/lutAtan2`
  (not `Math.sin/cos/atan2`), avoid `Math.hypot` in sim code (ULP-differs
  from wasm) — see AGENTS.md "Working in the sim now" for the full list.

## Doc trust levels

- Current: this file, `AGENTS.md` (rules + determinism discipline),
  `docs/dev-stream-sim.md` (maintained), ADRs (statuses are honest).
- Design reasoning: `docs/design-axioms.md` (2026-07-18) — generative,
  non-restrictive axioms (feel, feedback/economy, depth, pacing, reward)
  grounded in the game-design corpus (`qdrant-find` over `book_extractions`).
  Consult it for the *mechanism* behind a design call; it complements the
  pillars (identity) and the goal docs (specific systems).
- Historical/superseded (banners added 2026-07-08): the zig-wasm status
  docs (`zig-wasm-conversion-status.md`, `zig-wasm-migration-complete.md`)
  and the Convex-era architecture sections of `technical-design.md` /
  `game-design-document.md`.

<!-- convex-ai-start -->

Convex note (scoped): Convex is OPTIONAL and disabled in the live
deployment (`CONVEX_URL` unset). Only when actually editing code under
`convex/` should you read `convex/_generated/ai/guidelines.md` first.

<!-- convex-ai-end -->
