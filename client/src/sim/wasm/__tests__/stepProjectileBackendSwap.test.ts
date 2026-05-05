// Regression gate for setStepProjectileBackend. Confirms the
// swap mechanism doesn't break stepProjectile's existing
// behaviour: setting a backend that just calls a captured
// reference to the native impl must produce byte-identical
// output to no-swap.
//
// Future cuts will install a wasm-backed fn via
// applyWasmProjectileFlag(). This test catches the regression
// where the swap mechanism subtly diverges from the no-swap path.

import { describe, expect, test, afterEach } from "bun:test";
import {
  setStepProjectileBackend,
  spawnProjectile,
  stepProjectile,
  type StepProjectileFn,
} from "../../projectile";
import type {
  EntityId,
  PlayerId,
  ProjectileEntity,
  Tick,
} from "../../types";

afterEach(() => {
  setStepProjectileBackend(null);
});

function makeProjectile(): ProjectileEntity {
  return spawnProjectile(1 as EntityId, {
    ownerId: "p0" as PlayerId,
    origin: { x: 100, y: 200 },
    aimAngle: 0,
    speed: 800,
    damage: 10,
    lifetimeMs: 5000,
    radius: 6,
    shape: "circle",
    pathing: "gravity",
    element: "crystal",
  });
}

const ctx = {
  platforms: [],
  players: {},
  dtMs: 1000 / 60,
  tick: 0 as Tick,
  rngState: 1234,
};

describe("stepProjectile backend swap (regression gate)", () => {
  test("no swap: stepProjectile produces deterministic output", () => {
    setStepProjectileBackend(null);
    const proj = makeProjectile();
    const a = stepProjectile(proj, ctx);
    const b = stepProjectile(proj, ctx);
    expect(a).toEqual(b);
  });

  test("identity swap: backend = ref to no-swap fn produces identical output", () => {
    // Capture the native output first.
    setStepProjectileBackend(null);
    const proj = makeProjectile();
    const native = stepProjectile(proj, ctx);

    // Install an "identity" backend that just calls back into the
    // public fn after temporarily reverting. Tricky because this
    // would recurse — instead, the identity backend reproduces the
    // call site exactly. Use the public stepProjectile from a
    // captured-state perspective:
    const identityBackend: StepProjectileFn = (p, c) => {
      // Temporarily revert during this call so we hit the native
      // path directly. The afterEach reverts globally, but we
      // also restore a captured reference here for safety.
      setStepProjectileBackend(null);
      const r = stepProjectile(p, c);
      // Re-install ourselves so subsequent calls go through here.
      setStepProjectileBackend(identityBackend);
      return r;
    };
    setStepProjectileBackend(identityBackend);
    const swapped = stepProjectile(proj, ctx);
    expect(swapped).toEqual(native);
  });

  test("custom backend is invoked: counter increments", () => {
    let callCount = 0;
    const counter: StepProjectileFn = (p, c) => {
      callCount++;
      // Return a sentinel result so we don't depend on the native
      // output here.
      return {
        projectile: { ...p, x: 999, y: 999 },
        events: [],
        expired: false,
        spawned: [],
        rngState: c.rngState,
      };
    };
    setStepProjectileBackend(counter);
    const proj = makeProjectile();
    const r1 = stepProjectile(proj, ctx);
    const r2 = stepProjectile(proj, ctx);
    expect(callCount).toBe(2);
    expect(r1.projectile?.x).toBe(999);
    expect(r2.projectile?.x).toBe(999);
  });

  test("revert: setBackend(null) restores native path", () => {
    let invoked = false;
    setStepProjectileBackend(() => {
      invoked = true;
      return {
        projectile: null, events: [], expired: true, spawned: [], rngState: 0,
      };
    });
    setStepProjectileBackend(null);

    const proj = makeProjectile();
    const result = stepProjectile(proj, ctx);
    expect(invoked).toBe(false);
    // Native path produces a real projectile (non-expired since
    // lifetime is 5000ms and we ticked 16ms).
    expect(result.expired).toBe(false);
    expect(result.projectile).not.toBeNull();
  });
});
