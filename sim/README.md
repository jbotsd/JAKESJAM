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

## Phase A status

Skeleton only. Exports `alloc_state`, `free_state`, `state_size`,
`step` (no-op increment), `current_tick`, `reset`. Real sim logic
lands in Phase B.
