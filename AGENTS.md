# AGENTS.md — JAKESJAM Project Instructions

This file gives Codex and human contributors the project rules before making changes.

## Project Summary

JAKESJAM is a browser-first 2D multiplayer arena platform shooter inspired by fast side-view shooters and round-based upgrade drafting games.

Core design:

- 2D platform shooter.
- Fast movement.
- Projectile-based combat.
- Short 1v1 rounds first.
- Losing player drafts upgrade cards between rounds.
- Browser-first multiplayer.

## Source-of-Truth Docs

Read these before implementing gameplay features:

1. `docs/game-design-document.md`
2. `docs/codex-task-backlog.md`
3. `docs/milestone-roadmap.md` if present
4. `docs/technical-design.md` if present
5. `docs/changelog.md` if present

For multiplayer / netcode / sim work, the canonical refs are:

1. `docs/netcode-architecture.md` — substrate-neutral architecture
2. `docs/adr/0006-zig-wasm-sim-substrate.md` — current substrate decision
3. `docs/zig-wasm-migration.md` — phased rollout plan
4. `.claude/skills/deterministic-netcode-architecture/SKILL.md` —
   transferable rules
5. `.claude/skills/{zig-wasm-build,wasm-ts-bridge,wasm-game-sim-zig,zig-code-quality}/SKILL.md`
   — build + boundary + sim design specifics + Zig style/idiom rules

When implementation changes design behaviour, update the relevant doc.

## Substrate decision (May 2026) — migration substantially shipped

The deterministic sim core has been ported from TypeScript to **Zig
compiled to WebAssembly** to satisfy ADR-0001's "byte-identical
WorldStates" requirement at production scale. Native TS float math
isn't bit-deterministic across V8 (browser) and JSC (Bun); WASM
bytecode is, per spec.

**Status as of 2026-05-05**: migration substantially complete +
deployed to production.

| Phase | What | Status |
|---|---|---|
| A | Toolchain (Zig 0.15.2 pinned, `bun run sim:build`, Vite plugin, CI) | ✅ shipped |
| B2 | RNG (mulberry32) | ✅ shipped |
| B3 | Collision kernel + slide + drift snap + circles | ✅ shipped |
| B4 | Player physics (full stepPlayer) | ✅ shipped |
| F1b | Weapon math primitives | ✅ shipped |
| F1c | Satellite tick | ✅ shipped |
| F1d | Combat parry-arc | ✅ shipped |
| F1e | Destructible + Fire | ✅ shipped |
| F1a | Projectile pathing helpers + bounce + anti-homing + step_v2 | ✅ shipped |
| F2a | Comptime trig LUT | ✅ shipped |
| F2b | Static spatial grid | ✅ shipped |
| F3 | Default-on rollout (env vars are emergency disables) | ✅ shipped |
| D2 | Server-side wasm load + collision/player swap | ✅ shipped |
| D3 | TS-side cleanup audit (verdict: complete by construction) | ✅ shipped |
| Trig LUT install on server | Off-list bug fix | ✅ shipped |

**Read `docs/zig-wasm-migration-complete.md`** for the consolidated
retrospective. The full per-module exports manifest is in
`docs/zig-wasm-exports.md`.

### Working in the sim now

The live sim runs through wasm by default in production. Both
client and server install the comptime trig LUT at boot (so even
TS code paths using `lutCos/lutSin/lutAtan2` produce bit-identical
output). The three "swap" modules — `rng`, `collision`, `player` —
route to wasm through `set<X>Backend` mechanisms applied at boot
via `applyWasm*Flag()` in `client/src/sim/wasm/runtime.ts` (client)
and `server/src/wasmRuntime.ts` (server).

**When adding new sim work**:
- TS-side: use `lutCos/lutSin/lutAtan2` from `@sim/trig.ts`, NOT
  `Math.sin/cos/atan2`. The LUT bytes match wasm.
- Avoid `Math.hypot` — use `Math.sqrt(a*a + b*b)` (V8's hypot
  uses overflow-safe scaling that produces ULP-different bits
  from wasm's `@sqrt`).
- New Zig module: add to `sim/src/<mod>.zig`, add `pub const <mod>`
  + `_ = <mod>` in root.zig, write parity test under
  `client/src/sim/wasm/__tests__/`.
- Follow `.claude/skills/zig-code-quality/SKILL.md` — especially
  the "Lessons learned" section (operator order, hypot, LUT
  install discipline, etc.).

If you're adding netcode/sim code without seeing this section, **stop
and read the docs first**. Patches to the sim that don't honour
the determinism contract get reverted on principle, not on bug.

## Required Technical Direction

Use:

- Phaser + TypeScript for the client.
- Vite for client build tooling.
- Convex for lobby, room, player profile, ready state, chat/emotes, low-frequency room state, and match results.

Do not use Java as the main runtime.

Do not create `server-java/` unless explicitly requested after multiplayer prototype review.

## Multiplayer Boundary

Convex is for platform and low-frequency realtime state. It should not initially be used as a 60 FPS simulation server.

Good Convex usage:

- create room;
- join room;
- ready checks;
- player names/colours;
- lobby chat/emotes;
- match state transitions;
- draft selections;
- match results.

Avoid unless explicitly requested:

- writing player movement every frame;
- writing every projectile update;
- treating Convex as authoritative twitch-combat simulation;
- anti-cheat-critical validation.

Throttle player state snapshots if used.

## Coding Rules

- Prefer TypeScript types over implicit object shapes.
- Keep files small and focused.
- Avoid large rewrites unless asked.
- Implement one feature area per task.
- Use clear names for gameplay constants.
- Keep prototype values configurable in data files where practical.
- Do not add large dependencies without explaining why.
- Do not add final art/audio requirements before gameplay is proven.

## Expected Repo Shape

```text
client/
  Phaser + TypeScript + Vite game client

convex/
  Convex schema, queries, mutations, auth/lobby/rooms/matches

docs/
  design and planning docs

assets/
  placeholder and future game assets
```

## Definition of Done

A task is done when:

- TypeScript compiles.
- Relevant tests pass, if tests exist.
- The feature can be manually tested.
- The implementation matches the GDD or documents any intentional deviation.
- New gameplay constants are named clearly.
- The final response includes changed files and manual test steps.

## Good Task Format

Use tasks like this:

```text
Implement player jump buffering in client/src/sim/player.ts.
Acceptance criteria:
- jump input within 100ms before landing triggers jump on landing;
- buffer duration is configurable;
- existing movement still works;
- npm run typecheck passes.
```

Avoid vague tasks like:

```text
Make movement better.
```

## Current Prototype Priority

Build in this order:

1. Repo scaffold.
2. Offline movement playground.
3. Offline projectile combat.
4. Convex lobby prototype.
5. Online 1v1 match prototype.
6. Upgrade card draft.
7. MVP polish.

## Design Constraints

- The first real mode is 1v1 duel.
- The first weapon is the shared Starter Pistol / Scrap Rifle baseline.
- The first map is Boxworks.
- The first card pool should be small, around 12 cards.
- Weapon upgrades should be orthogonal and mutate the same baseline weapon before adding many unrelated guns.
- MVP target is one main map, four weapon paths, four character stat archetypes, four destructible element types, and up to 6-player stress testing after 1v1 works.
- MVP should prove fun before expanding content.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
