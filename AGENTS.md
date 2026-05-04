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

## Substrate decision (May 2026)

The deterministic sim core is moving from TypeScript to **Zig
compiled to WebAssembly** to satisfy ADR-0001's "byte-identical
WorldStates" requirement at production scale. Native TS float math
is not bit-deterministic across V8 (browser) and JSC (Bun); WASM
bytecode is, per spec.

**Phase A toolchain shipped 2026-05-04.** Zig 0.15.2 pinned in
`.zig-version`; `bun run sim:build` produces
`client/src/sim/wasm/sim.wasm`; `bun run sim:test` runs Zig unit
tests; `bun run sim:fmt` gates formatting. Vite plugin
(`client/vite-plugin-zig.ts`) rebuilds on `.zig` save with full
reload. CI installs Zig + caches the build.

**Phase B2 (RNG) + B3 (collision kernel + slide) shipped
2026-05-04.** `sim/src/{rng,collision}.zig` are bit-exact ports of
the TS originals. Cross-impl parity tests
(`client/src/sim/wasm/__tests__/{rngParity,collisionParity}.test.ts`)
prove byte-identical output between TS V8 and Zig wasm across
9000+ RNG iterations, 1600+ collision fixtures, and a 60-tick
independent-integration test. This empirically validates the
substrate thesis (ADR-0006).

Until Phase D cutover (see `docs/zig-wasm-migration.md`), the
**live sim still runs from TypeScript** in `client/src/sim/*.ts`.
The wasm loader at `client/src/sim/wasm/loader.ts` is staged but
not wired into `clientLoop.ts` or `matchHost.ts` yet. New sim
work should either:

- Land as a small last-mile change in TS that Phase B/C will
  re-implement in Zig, OR
- Land directly in `sim/src/*.zig` if it's part of the Phase B
  collision/player port (`docs/zig-wasm-migration.md` → Phase B).

If you're adding netcode/sim code without seeing this section, **stop
and read the docs above first**. Patches to the sim that don't honour
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
Implement player jump buffering in client/src/game/systems/MovementSystem.ts.
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
