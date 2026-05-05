# `sim/src/data/` — JAKESJAM-specific data tables

This directory holds the **game-specific** data tables that
parameterize the otherwise-generic core sim modules:

- `cards.zig` — Crystal Rounds card list + weapon-build resolution.
- `weapons.zig` — base weapon profiles (DPS, RPS, projectile shape).
- `chaos.zig` — chaos modifier definitions + per-tick effect hooks.
- `maps.zig` — per-map static AABBs + spawn points (for static
  spatial-grid bake).
- `pickups.zig` — pickup type → effect mapping.

**Layer rule (per `sim/README.md`):** these files import from the
core sim modules (`../rng.zig`, `../collision.zig`, etc.) but the
core modules MUST NOT reach back into this directory. Future
games swap their own `data/` in and inherit the rest unchanged.
