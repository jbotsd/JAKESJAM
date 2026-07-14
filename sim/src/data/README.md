# `sim/src/data/` — JAKESJAM-specific data tables

This directory holds the **game-specific** data tables that
parameterize the otherwise-generic core sim modules:

- `cards_gen.zig` — Crystal Rounds card list + weapon-build resolution.
  Machine-generated (see its own file header) from
  `client/src/sim/data/cards.ts` via `bun run gen:cards` — edit the TS
  source, not this file, then regenerate and `zig build`.
- `weapons.zig` — base weapon profiles (DPS, RPS, projectile shape).
- `chaos.zig` — chaos modifier definitions + per-tick effect hooks.
- `map_gen.zig` — per-map static AABBs + spawn points (for static
  spatial-grid bake).

No `pickups.zig` exists yet — pickup type → effect mapping is still
TS-only (buff durations and respawn scheduling are TS-driven; see
`world.zig`'s pickup-handling comments). Add it here once that logic
gets ported.

**Layer rule (per `sim/README.md`):** these files import from the
core sim modules (`../rng.zig`, `../collision.zig`, etc.) but the
core modules MUST NOT reach back into this directory. Future
games swap their own `data/` in and inherit the rest unchanged.
