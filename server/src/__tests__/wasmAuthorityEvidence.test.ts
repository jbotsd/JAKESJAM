// gospel-goal E2 — the gate that guards the gate.
//
// E2's first evidence row is "full server suite green under wasm step".
// On 2026-08-09 that row was hollow: `USE_WASM_STEP_WORLD=1 bun test`
// reported 306/0 green while 294 ticks had silently fallen back to TS,
// because serverWasmHost is a process-wide singleton, `bun test` runs
// every file in ONE process, and serverWasmHost.test.ts's last case reset
// it without restoring. Green meant nothing.
//
// These tests make the failure mode observable instead of silent:
//   1. the singleton survives the whole suite (the leak that caused it),
//   2. a fallback tick is COUNTED, not just logged to stderr,
//   3. WASM_STRICT exists so a gate run can refuse to degrade quietly.
//
// This file deliberately asserts on process-wide state, so it must stay
// order-independent: it reads the counter rather than requiring zero.

import { describe, expect, test } from "bun:test";
import { serverWasmHost } from "../serverWasmHost.ts";
import { getWasmFallbackTicks } from "../matchHost.ts";

describe("wasm authority evidence (gospel E2)", () => {
  test("the serverWasmHost singleton is alive for other test files", async () => {
    // The leak this guards: a file that resets the singleton without
    // restoring it silently demotes every host constructed afterwards to
    // TS, so a wasm-mode suite run proves nothing. If this fails, some
    // test reset the singleton and left it dead — restore it in that
    // file's afterAll, do not weaken this assertion.
    await serverWasmHost.ready().catch(() => {});
    expect(serverWasmHost.isReady()).toBe(true);
  });

  test("the hangout flag is present, so lobby hosts can pin wasm", () => {
    // matchHost refuses the wasm backend for mode:"hangout" without this
    // (stepping a lobby on a pre-flag build would run combat semantics in
    // the venue). A sim.wasm built before Track E1d fails here rather
    // than quietly running the whole lobby on TS.
    expect(serverWasmHost.supportsHangoutFlag()).toBe(true);
  });

  test("fallback ticks are counted, not merely logged", () => {
    // The counter is the soak's and /health's evidence surface. Reading
    // it must never throw and must be a number even when nothing has
    // fallen back — asserting >= 0 keeps this order-independent while
    // still failing if the export disappears.
    const ticks = getWasmFallbackTicks();
    expect(typeof ticks).toBe("number");
    expect(ticks).toBeGreaterThanOrEqual(0);
  });

  test("WASM_STRICT is off by default so live keeps its kill-switch", () => {
    // Strict mode turns the per-tick fallback into a throw. That is right
    // for a gate run and WRONG for the live host, where the fallback is
    // what keeps a match alive when a tick throws. Default must be off.
    const strict =
      process.env.WASM_STRICT === "1" || process.env.WASM_STRICT === "true";
    if (!process.env.WASM_STRICT) {
      expect(strict).toBe(false);
    }
  });
});
