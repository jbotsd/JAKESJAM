// H7 gate — round_step_phase produces the same phase + countdown
// transitions as the corresponding portion of TS `stepRound`.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadSimFromBytes } from "../loader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");

const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const sim = await loadSimFromBytes(ab);

type RoundExports = {
  round_step_phase: (
    phase: number,
    remaining_ms: number,
    dt_ms: number,
    winner_decided: number,
    out_ptr: number,
  ) => void;
  round_countdown_ms: () => number;
  round_time_limit_ms: () => number;
  round_over_hold_ms: () => number;
  round_draft_window_ms: () => number;
  sizeof_round_phase_step_result: () => number;
  memory: WebAssembly.Memory;
};
const ex = sim.exports as unknown as RoundExports;

const RESULT_SIZE = ex.sizeof_round_phase_step_result();
const OUT_PTR = sim.statePtr; // borrow the static buffer

const PHASE_COUNTDOWN = 0;
const PHASE_FIGHTING = 1;
const PHASE_ROUND_OVER = 2;
// Added Phase 2 (docs/zig-step-world-parity-goal.md, 2026-07-20): round-over
// now always routes through drafting before countdown — the dead
// RoundPhase.drafting branch this file's own header comment used to note
// as "never entered" is wired for real now (sim/src/draft.zig). The
// exported round_step_phase's own arity stayed fixed (still takes
// winner_decided, not a 6th drafting_all_resolved arg) specifically so
// this file's existing calls keep working unchanged — see draft.zig's own
// doc comment for why. That means this wasm export always resolves
// drafting_all_resolved=false internally; the real gating on "did every
// player finish picking" only exists in world.zig's native orchestrator,
// not reachable from this parity harness — round_over→drafting is provable
// here, drafting→countdown on early-all-picked is not (drafting→countdown
// on WINDOW EXPIRY still is, since that path doesn't depend on the missing
// arg — see the new test below).
const PHASE_DRAFTING = 3;

function call(
  phase: number,
  remaining: number,
  dt: number,
  winner: number,
): { phase: number; transitioned: number; remaining: number } {
  ex.round_step_phase(phase, remaining, dt, winner, OUT_PTR);
  const view = new DataView(ex.memory.buffer);
  return {
    phase: view.getUint8(OUT_PTR),
    transitioned: view.getUint8(OUT_PTR + 1),
    remaining: view.getFloat64(OUT_PTR + 8, true),
  };
}

describe("round phase machine parity (Phase H7)", () => {
  test("constants match TS-side round.ts pinned values", () => {
    expect(ex.round_countdown_ms()).toBe(3000);
    expect(ex.round_time_limit_ms()).toBe(90_000);
    expect(ex.round_over_hold_ms()).toBe(2500);
    expect(RESULT_SIZE).toBe(16);
  });

  test("countdown ticks down without transition", () => {
    const r = call(PHASE_COUNTDOWN, 1500, 16.667, 0);
    expect(r.phase).toBe(PHASE_COUNTDOWN);
    expect(r.transitioned).toBe(0);
    expect(r.remaining).toBeCloseTo(1500 - 16.667, 6);
  });

  test("countdown→fighting when remaining hits 0; resets to ROUND_TIME_LIMIT_MS", () => {
    const r = call(PHASE_COUNTDOWN, 10, 16.667, 0);
    expect(r.phase).toBe(PHASE_FIGHTING);
    expect(r.transitioned).toBe(1);
    expect(r.remaining).toBe(90_000);
  });

  test("fighting ticks down without transition", () => {
    const r = call(PHASE_FIGHTING, 50_000, 16.667, 0);
    expect(r.phase).toBe(PHASE_FIGHTING);
    expect(r.transitioned).toBe(0);
  });

  test("fighting→round_over on time limit", () => {
    const r = call(PHASE_FIGHTING, 10, 16.667, 0);
    expect(r.phase).toBe(PHASE_ROUND_OVER);
    expect(r.transitioned).toBe(1);
    expect(r.remaining).toBe(2500);
  });

  test("fighting→round_over on winner_decided=1 even with time remaining", () => {
    const r = call(PHASE_FIGHTING, 50_000, 16.667, 1);
    expect(r.phase).toBe(PHASE_ROUND_OVER);
    expect(r.transitioned).toBe(1);
    expect(r.remaining).toBe(2500);
  });

  test("round_over→drafting when hold finishes (was round_over→countdown before Phase 2)", () => {
    const r = call(PHASE_ROUND_OVER, 10, 16.667, 0);
    expect(r.phase).toBe(PHASE_DRAFTING);
    expect(r.transitioned).toBe(1);
    expect(r.remaining).toBe(ex.round_draft_window_ms());
  });

  test("drafting→countdown when the offer window itself expires (all-picked early-resolve isn't reachable through this fixed-arity export — see header comment)", () => {
    const r = call(PHASE_DRAFTING, 10, 16.667, 0);
    expect(r.phase).toBe(PHASE_COUNTDOWN);
    expect(r.transitioned).toBe(1);
    expect(r.remaining).toBe(3000);
  });

  test("drafting ticks down without transition before the window expires", () => {
    const r = call(PHASE_DRAFTING, 5000, 16.667, 0);
    expect(r.phase).toBe(PHASE_DRAFTING);
    expect(r.transitioned).toBe(0);
    expect(r.remaining).toBeCloseTo(5000 - 16.667, 6);
  });
});
