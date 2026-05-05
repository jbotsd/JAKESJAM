# sim/

Deterministic simulation core for JAKESJAM, written in Zig and
compiled to WebAssembly. The same `.wasm` runs in the browser
(client prediction) and in Bun (authoritative server) — IEEE 754
ops are bit-exact across hosts per the WebAssembly spec, which
makes the netcode reconcile path exact rather than approximate.

See:
- `docs/adr/0006-zig-wasm-sim-substrate.md` — decision rationale.
- `docs/zig-wasm-migration.md` — phased rollout plan.
- `docs/netcode-architecture.md` — substrate-neutral architecture.

## Build

```sh
cd sim
zig build           # produces ../client/src/sim/wasm/sim.wasm
zig build test      # runs sim/test/*.zig natively
zig fmt --check .   # format gate
```

Toolchain pinned in `../.zig-version` (currently `0.15.2`).

## Package boundaries (KEEP THESE)

This Zig crate is **two layers**, kept separate so the core can
be lifted into future games:

1. **Core sim** — game-agnostic deterministic primitives.
   `rng.zig`, `hash.zig`, `trig.zig`, `collision.zig`,
   `spatial.zig`, `player.zig`, `projectile.zig`, `weapon.zig`,
   `combat.zig`, `destructible.zig`, `fire.zig`,
   `satellite.zig`, `world_state.zig`. No JAKESJAM-specific
   cards, weapon tables, or chaos modifiers reach these files.

2. **JAKESJAM data + orchestrator** — `data/*.zig` and
   `world.zig`. Holds the card list, weapon profiles, chaos
   modifier definitions, and the per-tick orchestration that
   wires them into the core sim. This is where game-specific
   tuning lives.

Future games reuse layer 1 directly and write their own layer 2.
Don't import `data/` from inside layer 1.

The TS netcode layer (`client/src/net/`) is similarly
game-agnostic — it carries `WorldState` shapes from `@sim/types`
and `@sim/wasm/worldStateBridge` but doesn't reach into Phaser
or JAKESJAM data. Future games can import this netcode crate
unchanged.

## Phase progress

- A — skeleton ✅
- B — RNG, hash, trig LUT, collision ✅
- C — player physics ✅
- D — projectile (incl. v2 8-pathing dispatch) ✅
- E — weapon, satellite, combat, destructible, fire ✅
- F — backend swap mechanisms + default-on rollout ✅
- G — WorldState extern struct + bridge ✅ (G1a/G1b/G1c/G2/G3)
- H — per-module full orchestration (in progress)
- I — `step_world` orchestrator (pending)
- J/K/L/M — production cutover, deletion, validation, decommission
