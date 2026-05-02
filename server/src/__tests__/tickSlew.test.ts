// Tests for TickSlewController — verifies steady-state dead band, early/late
// arrival detection, empty-window safety, cap enforcement, and matchHost
// integration.
//
// Sign convention recap:
//   delta = serverTick - inputTick.
//   Target: delta = -TARGET_LEAD_TICKS = -2  (inputs arrive 2 ticks ahead).
//   Client too FAST (inputs arrive early): delta < -2 → +ve tickAdjustMs (slow down).
//   Client too SLOW (inputs arrive late):  delta > -2 → -ve tickAdjustMs (speed up).

import { describe, test, expect, beforeEach } from "bun:test";
import { TickSlewController } from "../TickSlewController.ts";
import { PlayerId, Tick } from "@sim/types.ts";

const P = PlayerId("player-a");

const TARGET_LEAD_TICKS = 2;
const WINDOW_SAMPLES = 30;

/** Fill the controller with `count` samples all having serverTick - inputTick === delta. */
function fillSteady(ctrl: TickSlewController, delta: number, count = WINDOW_SAMPLES): void {
  for (let i = 0; i < count; i++) {
    const serverTick = Tick(100 + i);
    const inputTick = Tick((serverTick as number) - delta);
    ctrl.recordInput(P, { serverTick, inputTick });
  }
}

describe("TickSlewController", () => {
  let ctrl: TickSlewController;

  beforeEach(() => {
    ctrl = new TickSlewController();
  });

  test("1: steady state at target (delta = -2) returns 0 (inside dead band)", () => {
    fillSteady(ctrl, -TARGET_LEAD_TICKS);
    expect(ctrl.computeAdjustMs(P)).toBe(0);
  });

  test("2: inputs arriving consistently EARLY (delta = -3) → positive adj (slow down)", () => {
    // delta = -3: client is 3 ticks ahead, target is 2. Too fast → slow down → +ve.
    fillSteady(ctrl, -3);
    const adj = ctrl.computeAdjustMs(P);
    expect(adj).toBeGreaterThan(0);
  });

  test("3: inputs arriving consistently LATE (delta = -1) → negative adj (speed up)", () => {
    // delta = -1: client is only 1 tick ahead, needs to be 2. Too slow → speed up → -ve.
    fillSteady(ctrl, -1);
    const adj = ctrl.computeAdjustMs(P);
    expect(adj).toBeLessThan(0);
  });

  test("4: empty window returns 0", () => {
    expect(ctrl.computeAdjustMs(P)).toBe(0);
  });

  test("5: extreme early arrival is capped at MAX_SLEW_MS_PER_TICK (+1 ms)", () => {
    // delta = -10: wildly too far ahead. Raw correction >> 1 ms but capped.
    fillSteady(ctrl, -10);
    const adj = ctrl.computeAdjustMs(P);
    expect(adj).toBeGreaterThan(0);
    expect(adj).toBeLessThanOrEqual(1);
  });
});

// ---- Integration: matchHost exposes tickSlew and it produces expected results ----
import { MatchHost } from "../matchHost.ts";
import type { PlayerSpawnInfo } from "@sim/types.ts";

describe("MatchHost slew integration", () => {
  test("tickSlew produces +ve adj after filling window with early-arriving inputs", () => {
    const spawn: PlayerSpawnInfo = {
      playerId: PlayerId("p1"),
      characterId: "balanced",
      weaponId: "starter-pistol",
      color: "#ff0000",
      name: "P1",
    };
    const host = new MatchHost("test-match", [spawn], []);

    // Reach the private TickSlewController via an intentional cast.
    // This is test-only; the field is private to the production class.
    const slew = (host as unknown as { tickSlew: TickSlewController }).tickSlew;

    const pid = PlayerId("p1");
    for (let i = 0; i < WINDOW_SAMPLES; i++) {
      // inputTick is 10 ticks ahead of serverTick (strongly early).
      slew.recordInput(pid, {
        serverTick: Tick(100 + i),
        inputTick: Tick(110 + i),
      });
    }

    const adj = slew.computeAdjustMs(pid);
    // delta = serverTick - inputTick = -10 (far ahead of target -2) → slow down → +ve.
    expect(adj).toBeGreaterThan(0);
    expect(adj).toBeLessThanOrEqual(1);
  });
});
