// Behavioral contract for the Veil-of-Nought body read (Track L). Targets
// the pure Phaser-free planner (render/veilReadPlan) — same convention as
// ConstructVfxController.test.ts / entanglementPlan: the tested layer
// produces plain data, the Phaser painting is verified live.

import { describe, expect, test } from "bun:test";
import { makeVeilReadMemo, planVeilRead } from "../veilReadPlan";
import type { PlayerId, Vec2, WorldState } from "../../../sim";

function stateWith(
  tick: number,
  players: Record<string, { alive?: boolean; veilUntil?: number }>,
): WorldState {
  const ps: Record<string, unknown> = {};
  for (const [id, p] of Object.entries(players)) {
    ps[id] = {
      alive: p.alive ?? true,
      veilUntilTick: p.veilUntil,
    };
  }
  return { tick, players: ps } as unknown as WorldState;
}

const POS: Record<string, Vec2> = {
  v: { x: 100, y: 200 },
  w: { x: 500, y: 200 },
};
const getPosition = (id: PlayerId): Vec2 | undefined => POS[id as string];

describe("planVeilRead — Veil of Nought body read", () => {
  test("a live veil window plans a full-intensity shroud at the body", () => {
    const memo = makeVeilReadMemo();
    const plan = planVeilRead(stateWith(50, { v: { veilUntil: 140 } }), getPosition, memo);
    expect(plan.shrouds.length).toBe(1);
    expect(plan.shrouds[0]!.id).toBe("v");
    expect(plan.shrouds[0]!.pos).toEqual(POS.v!);
    expect(plan.shrouds[0]!.intensity).toBe(1);
    expect(plan.breaks.length).toBe(0);
  });

  test("the shroud eases out over the window's final ~300ms (expiry tell)", () => {
    const memo = makeVeilReadMemo();
    // 6 ticks left at ~16.67ms/tick ≈ 100ms remaining → intensity ≈ 1/3.
    const plan = planVeilRead(stateWith(134, { v: { veilUntil: 140 } }), getPosition, memo);
    expect(plan.shrouds.length).toBe(1);
    expect(plan.shrouds[0]!.intensity).toBeGreaterThan(0);
    expect(plan.shrouds[0]!.intensity).toBeLessThan(0.5);
  });

  test("natural expiry (stale past tick) plans nothing — no shroud, no break", () => {
    const memo = makeVeilReadMemo();
    // Live frame first so the memo has a true edge to potentially misread.
    planVeilRead(stateWith(50, { v: { veilUntil: 60 } }), getPosition, memo);
    // Window passed; the sim leaves the stale tick in place.
    const plan = planVeilRead(stateWith(61, { v: { veilUntil: 60 } }), getPosition, memo);
    expect(plan.shrouds.length).toBe(0);
    expect(plan.breaks.length).toBe(0);
  });

  test("break-on-firing (cleared to undefined while live) plans one seam-snap", () => {
    const memo = makeVeilReadMemo();
    planVeilRead(stateWith(50, { v: { veilUntil: 140 } }), getPosition, memo);
    const plan = planVeilRead(stateWith(51, { v: {} }), getPosition, memo);
    expect(plan.shrouds.length).toBe(0);
    expect(plan.breaks.length).toBe(1);
    expect(plan.breaks[0]!.id).toBe("v");
    expect(plan.breaks[0]!.pos).toEqual(POS.v!);
    // The edge is consumed — the next frame plans nothing.
    const after = planVeilRead(stateWith(52, { v: {} }), getPosition, memo);
    expect(after.breaks.length).toBe(0);
  });

  test("a veiled player dying never fakes a break (field survives death)", () => {
    const memo = makeVeilReadMemo();
    planVeilRead(stateWith(50, { v: { veilUntil: 140 } }), getPosition, memo);
    // Killed while veiled: alive=false, field still defined → neither list.
    const dead = planVeilRead(
      stateWith(51, { v: { veilUntil: 140, alive: false } }),
      getPosition,
      memo,
    );
    expect(dead.shrouds.length).toBe(0);
    expect(dead.breaks.length).toBe(0);
    // Respawn with a fresh entity (field undefined): still no break —
    // the window wasn't live last frame.
    const respawned = planVeilRead(stateWith(400, { v: {} }), getPosition, memo);
    expect(respawned.breaks.length).toBe(0);
  });

  test("unveiled players plan nothing; memo drops roster leavers", () => {
    const memo = makeVeilReadMemo();
    const plan = planVeilRead(
      stateWith(50, { v: {}, w: { veilUntil: 140 } }),
      getPosition,
      memo,
    );
    expect(plan.shrouds.map((s) => s.id)).toEqual(["w"]);
    expect(memo.wasLive.size).toBe(2);
    // w leaves the roster entirely → memo entry dropped, no ghost break.
    const after = planVeilRead(stateWith(51, { v: {} }), getPosition, memo);
    expect(after.breaks.length).toBe(0);
    expect(memo.wasLive.size).toBe(1);
  });
});
