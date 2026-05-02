// Tests for the pure interpolation helper exported from RemotePlayerManager.
// We do NOT instantiate the manager itself in tests because constructing it
// pulls ProceduralPlayerRig + Phaser into the test runtime, which breaks
// under bun:test (no DOM). The interpolation math is the actual interesting
// logic anyway — the rest of the manager is glue around 3 Maps.

import { describe, expect, test } from "bun:test";
import { smoothSnapshot } from "../remoteSnapshotInterpolation";
import type { MatchPlayerSnapshot } from "../../types/net";

function makeSnapshot(overrides: Partial<MatchPlayerSnapshot>): MatchPlayerSnapshot {
  return {
    matchId: "m" as MatchPlayerSnapshot["matchId"],
    roomId: "r" as MatchPlayerSnapshot["roomId"],
    playerId: "p1",
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    aimAngle: 0,
    health: 100,
    alive: true,
    crouching: false,
    sequence: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("smoothSnapshot", () => {
  test("blends position toward the next frame at REMOTE_SMOOTHING (0.26)", () => {
    const prev = makeSnapshot({ position: { x: 0, y: 0 } });
    const next = makeSnapshot({ position: { x: 100, y: 200 } });
    const out = smoothSnapshot(prev, next);
    // 0 + (100 - 0) * 0.26 = 26
    expect(out.position.x).toBeCloseTo(26, 6);
    expect(out.position.y).toBeCloseTo(52, 6);
  });

  test("blends velocity at the same factor", () => {
    const prev = makeSnapshot({ velocity: { x: 10, y: -10 } });
    const next = makeSnapshot({ velocity: { x: 30, y: 10 } });
    const out = smoothSnapshot(prev, next);
    // 10 + (30 - 10) * 0.26 = 15.2
    expect(out.velocity.x).toBeCloseTo(15.2, 6);
    expect(out.velocity.y).toBeCloseTo(-4.8, 6);
  });

  test("rotates aim angle by the configured step (0.35 rad) toward target", () => {
    const prev = makeSnapshot({ aimAngle: 0 });
    const next = makeSnapshot({ aimAngle: 1 });
    const out = smoothSnapshot(prev, next);
    // RotateTo with step 0.35: 0 + 0.35 (step toward 1).
    expect(out.aimAngle).toBeCloseTo(0.35, 6);
  });

  test("snaps aim angle to target when within step distance", () => {
    const prev = makeSnapshot({ aimAngle: 1.2 });
    const next = makeSnapshot({ aimAngle: 1.3 });
    const out = smoothSnapshot(prev, next);
    expect(out.aimAngle).toBeCloseTo(1.3, 6);
  });

  test("preserves all non-interpolated fields from the new snapshot", () => {
    const prev = makeSnapshot({ health: 100, alive: true, sequence: 5 });
    const next = makeSnapshot({ health: 60, alive: false, sequence: 6 });
    const out = smoothSnapshot(prev, next);
    expect(out.health).toBe(60);
    expect(out.alive).toBe(false);
    expect(out.sequence).toBe(6);
  });

  test("rotates along the shorter arc (wraparound near pi/-pi)", () => {
    const prev = makeSnapshot({ aimAngle: Math.PI - 0.05 });
    const next = makeSnapshot({ aimAngle: -Math.PI + 0.05 });
    const out = smoothSnapshot(prev, next);
    // Within step distance of target (0.1 < 0.35): snaps to target.
    expect(out.aimAngle).toBeCloseTo(-Math.PI + 0.05, 6);
  });
});
