// Regression test for the Phase F3 default-on flip.
//
// The contract: `config.wasmCollision` and `config.wasmPlayer`
// default to TRUE in fresh server starts. The env vars
// `JAKESJAM_WASM_COLLISION` and `JAKESJAM_WASM_PLAYER` are
// emergency-disable knobs ("=0" disables; any other value or
// unset → enabled).
//
// If anyone accidentally reverts to `=== "1"` semantics (the
// pre-F3 opt-in pattern), this test fails immediately. Without
// it the regression would be silent: server ships with default-on
// expectation but actually runs TS-only fallback.
//
// We test the env-parsing logic directly rather than the imported
// `config` object because the latter is module-cached by the
// tsconfig path alias.

import { describe, expect, test } from "bun:test";

// Mirror the parsing in `server/src/config.ts`. If config.ts
// changes, this mirror has to change too — that's the WHOLE point.
function parseWasmCollision(env: Record<string, string | undefined>): boolean {
  return env.JAKESJAM_WASM_COLLISION !== "0";
}
function parseWasmPlayer(env: Record<string, string | undefined>): boolean {
  return env.JAKESJAM_WASM_PLAYER !== "0";
}

describe("config — wasm flag default-on (F3 regression gate)", () => {
  test("collision defaults ON when env unset", () => {
    expect(parseWasmCollision({})).toBe(true);
  });

  test("player defaults ON when env unset", () => {
    expect(parseWasmPlayer({})).toBe(true);
  });

  test("collision OFF when explicitly =0", () => {
    expect(parseWasmCollision({ JAKESJAM_WASM_COLLISION: "0" })).toBe(false);
  });

  test("player OFF when explicitly =0", () => {
    expect(parseWasmPlayer({ JAKESJAM_WASM_PLAYER: "0" })).toBe(false);
  });

  test("collision ON for any non-zero value (typical accident: =true)", () => {
    expect(parseWasmCollision({ JAKESJAM_WASM_COLLISION: "1" })).toBe(true);
    expect(parseWasmCollision({ JAKESJAM_WASM_COLLISION: "true" })).toBe(true);
    expect(parseWasmCollision({ JAKESJAM_WASM_COLLISION: "" })).toBe(true);
    expect(parseWasmCollision({ JAKESJAM_WASM_COLLISION: "false" })).toBe(true);
  });

  test("the actual config module has the expected defaults", async () => {
    // Defensive — confirm config.ts hasn't drifted to a different
    // default. Imports lazily so the test isolates from prior
    // module loads.
    const { config } = await import("../config.ts");
    // In test environments the env vars are typically unset, so
    // both should be ON. If a developer happens to have them set
    // to "0" locally, allow that case but fail-loud if anything
    // else is going on.
    if (process.env.JAKESJAM_WASM_COLLISION === "0") {
      expect(config.wasmCollision).toBe(false);
    } else {
      expect(config.wasmCollision).toBe(true);
    }
    if (process.env.JAKESJAM_WASM_PLAYER === "0") {
      expect(config.wasmPlayer).toBe(false);
    } else {
      expect(config.wasmPlayer).toBe(true);
    }
  });
});
