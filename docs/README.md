# JAKESJAM docs

Game design + technical reference for JAKESJAM.

> **Doc freshness (2026-07-08):** these docs are a mix of current
> reference and historical planning records — several describe plans that
> were later reverted or superseded, and they have misled agent sessions
> before. **The repo-root `CLAUDE.md` is the verified current state and
> wins on any conflict.** Known-stale docs carry correction banners:
> `zig-wasm-conversion-status.md` (FULL-Zig cutover — reverted),
> `zig-wasm-migration-complete.md` (scope caveat), and the Convex-era
> architecture sections of `technical-design.md` /
> `game-design-document.md` (deployment is now the self-contained Bun
> host, not Vercel/Convex).

## Start here

- [`game-design-document.md`](game-design-document.md) — the GDD.
  Round structure, weapons, cards, art direction.
- [`technical-design.md`](technical-design.md) — high-level
  architecture (client + server + Convex + sim).
- [`milestone-roadmap.md`](milestone-roadmap.md) — what's planned
  vs shipped per milestone.
- [`changelog.md`](changelog.md) — versioned commit-level
  changelog (current: v0.x).

## Zig→WASM substrate (the determinism core)

The deterministic sim has been ported from TypeScript to Zig
compiled to WebAssembly so client predict + server authority
produce byte-identical state across hosts. Read in this order:

1. [`zig-wasm-migration-complete.md`](zig-wasm-migration-complete.md)
   — **start here**. Consolidated retrospective: what shipped,
   determinism contract, how to run / verify / extend.
2. [`adr/0006-zig-wasm-sim-substrate.md`](adr/0006-zig-wasm-sim-substrate.md)
   — the substrate decision ADR. Why Zig→WASM over Q16.16
   fixed-point or Rust→WASM.
3. [`zig-wasm-migration.md`](zig-wasm-migration.md) — phased
   rollout plan (A/B/C/D/F). Marks each cut ✅ shipped or new.
4. [`zig-wasm-exports.md`](zig-wasm-exports.md) — exports
   manifest. Every wasm function with its purpose + parity test.
5. [`zig-wasm-d3-audit.md`](zig-wasm-d3-audit.md) — Phase D3
   cleanup audit. Conclusion: D3 is complete by construction
   thanks to the comptime trig LUT.
6. [`zig-wasm-perf-baseline.md`](zig-wasm-perf-baseline.md) —
   measured ns/op for TS-libm vs TS-LUT vs wasm-LUT for the hot
   paths.
7. [`zig-wasm-runbook.md`](zig-wasm-runbook.md) — emergency
   procedures when something breaks in production. Quick
   reference for diagnostics + rollback ladder.

## Netcode + sim architecture

- [`netcode-architecture.md`](netcode-architecture.md) —
  substrate-neutral architecture (client predict + server
  authority + reconcile).
- ADRs in [`adr/`](adr/) — architectural decisions with rationale.

## Skills (architectural rules per area)

For agents working in this repo. See `.claude/skills/`:

- `zig-code-quality` — Zig style + idiom + footguns (incl. 10
  lessons learned from this migration).
- `zig-wasm-build` — toolchain + build setup.
- `wasm-ts-bridge` — TS↔wasm boundary patterns.
- `wasm-game-sim-zig` — wasm-specific sim design (allocators,
  SoA, fixed buffers).
- `deterministic-netcode-architecture` — substrate-neutral
  generalisation.
- `game-sim-determinism` — JAKESJAM-specific sim purity rules.
- `game-netcode` — netcode tuning specifics.
- `phaser4-game` — Phaser 4 client patterns.
- `combat-balance-ttk` — gameplay balance rules.

## Visual + design

- [`art-direction.md`](art-direction.md) — visual direction.
- [`themes.md`](themes.md) — palette + theme switching.
- [`jakesjam-design-pillars.md`](jakesjam-design-pillars.md) —
  core gameplay pillars.
- [`game-design-document-copy-paste.md`](game-design-document-copy-paste.md) —
  GDD in copy-paste-friendly form.

## QA / testing

- [`playtest-qa.md`](playtest-qa.md) — playtest checklist.
- [`playtest-stress-plan.md`](playtest-stress-plan.md) —
  stress-test approach.
- [`release-readiness-checklist.md`](release-readiness-checklist.md) —
  pre-release gates.
