// Server-side LUT install regression test.
//
// The bug this gates: the client's `client/src/sim/wasm/runtime.ts`
// installs the comptime trig LUT at boot (so TS-side `lutCos/lutSin/
// lutAtan2` sample the same bytes wasm uses). The server's
// `wasmRuntime.ts` originally did NOT install the LUT, so server-
// side `lutCos(x)` fell back to `Math.cos(x)` — different bits
// from the client's LUT-quantised value. Every trig-driven event
// (weapon firing, satellite orbit, parry-arc check, projectile
// float pathing) produced predict-vs-authority drift on the
// affected ticks.
//
// Fix: `loadServerSim` now installs the LUT immediately after
// instantiation. This test catches any regression of that.

import { afterEach, describe, expect, test } from "bun:test";
import { setRngBackend, nextU32Native } from "@sim/rng.ts";
import { setResolveMoveCachedBackend } from "@sim/collision.ts";
import { setStepPlayerBackend } from "@sim/player.ts";
import { lutTablesInstalled, lutCos, lutSin, lutAtan2 } from "@sim/trig.ts";
import { loadServerSim } from "../wasmRuntime.ts";

afterEach(() => {
  setRngBackend(nextU32Native);
  setResolveMoveCachedBackend(null);
  setStepPlayerBackend(null);
});

describe("server-side trig LUT install (regression gate)", () => {
  test("loadServerSim installs the LUT", async () => {
    // The test runner may have already booted the LUT via earlier
    // tests in this suite; tolerate that, just confirm it's
    // installed after loadServerSim runs.
    await loadServerSim();
    expect(lutTablesInstalled()).toBe(true);
  });

  test("server-side lutCos/lutSin/lutAtan2 produce LUT-quantised values, not libm", async () => {
    await loadServerSim();
    expect(lutTablesInstalled()).toBe(true);

    // The LUT has 1024 entries over [0, π/2] with linear interpolation
    // between adjacent samples. For inputs that don't land exactly on
    // a sample point, the LUT result differs from Math.cos by some
    // small but non-zero amount. If the LUT IS installed, lutCos
    // returns the LUT value; if NOT, it falls back to Math.cos.
    //
    // We can detect "fell back to Math.cos" by checking that lutCos
    // EQUALS Math.cos for non-trivial inputs (which would only happen
    // if the LUT impl was inactive). With LUT installed, equality
    // will be rare for arbitrary inputs.
    let exactMatches = 0;
    const samples = 1000;
    for (let i = 0; i < samples; i++) {
      const x = -10 + (i / samples) * 20;
      if (lutCos(x) === Math.cos(x)) exactMatches++;
    }
    // If the LUT was installed, exactMatches should be a small
    // fraction (just sample-point coincidences). If the LUT was
    // NOT installed, every call falls back to Math.cos and
    // exactMatches === samples.
    expect(exactMatches).toBeLessThan(samples / 2);
  });

  test("server-side lutAtan2 close to but not equal to Math.atan2 with LUT installed", async () => {
    await loadServerSim();
    expect(lutTablesInstalled()).toBe(true);
    let exactMatches = 0;
    let closeEnough = 0;
    const samples = 200;
    for (let i = 0; i < samples; i++) {
      const y = -100 + i * 1;
      const x = 50 + (i % 7) * 7;
      const lut = lutAtan2(y, x);
      const libm = Math.atan2(y, x);
      if (lut === libm) exactMatches++;
      if (Math.abs(lut - libm) < 0.01) closeEnough++;
    }
    expect(exactMatches).toBeLessThan(samples / 2);
    // But within reasonable tolerance.
    expect(closeEnough).toBeGreaterThan(samples - 5);
  });

  test("LUT install survives multiple loadServerSim calls (caching)", async () => {
    await loadServerSim();
    const firstAtZero = lutSin(0);
    await loadServerSim(); // should be cached + LUT still valid
    const secondAtZero = lutSin(0);
    expect(secondAtZero).toBe(firstAtZero);
    expect(lutTablesInstalled()).toBe(true);
  });
});
