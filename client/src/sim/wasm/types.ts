// TS mirror of sim/src/root.zig exports.
//
// Phase A surface: round-trip the no-op step. Phase B+ extends with
// the real WorldState struct layout and full step signature once the
// Zig sim modules land. Anything added here must match the Zig
// `pub export fn` signatures byte-for-byte — see ADR-0006.

export interface SimExports {
  readonly memory: WebAssembly.Memory;
  alloc_state(): number;
  free_state(ptr: number): void;
  state_size(): number;
  step(
    statePtr: number,
    stateLen: number,
    inputsPtr: number,
    inputsLen: number,
    dtMs: number,
  ): void;
  current_tick(): number;
  reset(): void;
  // Phase B2 — RNG (parity-proven against TS impl)
  rng_next_u32(state: number): number;
  rng_next_int(state: number, min: number, maxExclusive: number): bigint;
  // Phase B3 — collision (parity-proven)
  sweep_against_one_flat(
    mx: number,
    my: number,
    mw: number,
    mh: number,
    dx: number,
    dy: number,
    tx: number,
    ty: number,
    tw: number,
    th: number,
    outT: number,
    outNx: number,
    outNy: number,
  ): number;
  sweep_aabb_many(
    mx: number,
    my: number,
    mw: number,
    mh: number,
    vx: number,
    vy: number,
    dt: number,
    staticsPtr: number,
    staticsCount: number,
    outHitPtr: number,
  ): number;
  resolve_move(
    mx: number,
    my: number,
    mw: number,
    mh: number,
    vx: number,
    vy: number,
    dt: number,
    staticsPtr: number,
    staticsCount: number,
    outPtr: number,
  ): void;
  sweep_aabb_cached(
    mx: number,
    my: number,
    mw: number,
    mh: number,
    vx: number,
    vy: number,
    dt: number,
    staticsPtr: number,
    staticsCount: number,
    oneWayPtr: number,
    oneWayCount: number,
    outHitPtr: number,
  ): number;
  resolve_move_cached(
    mx: number,
    my: number,
    mw: number,
    mh: number,
    vx: number,
    vy: number,
    dt: number,
    staticsPtr: number,
    staticsCount: number,
    oneWayPtr: number,
    oneWayCount: number,
    outPtr: number,
  ): void;
  // Phase B4 — player physics (parity-proven across 90-tick run)
  step_player(
    statePtr: number,
    prevKeys: number,
    currKeys: number,
    aimX: number,
    aimY: number,
    speedMul: number,
    gravityMul: number,
    dtMs: number,
    staticsPtr: number,
    staticsCount: number,
    oneWayPtr: number,
    oneWayCount: number,
  ): number;
  sizeof_aabb(): number;
  sizeof_sweep_hit(): number;
  sizeof_resolve_move_out(): number;
  sizeof_player_step(): number;
  // Phase F2a — comptime trig LUTs
  lut_sin(x: number): number;
  lut_cos(x: number): number;
  lut_atan2(y: number, x: number): number;
  lut_sin_table_ptr(): number;
  lut_atan_table_ptr(): number;
  lut_table_size(): number;
}
