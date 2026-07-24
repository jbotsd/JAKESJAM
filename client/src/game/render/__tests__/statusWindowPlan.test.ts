// Behavioral contract for the self-window body reads (Track L,
// docs/legibility-audit.md — counter/seal/tithe/measure/surge/vuln/jam/
// fooled/aegis/fangs). Targets the pure Phaser-free planner
// (render/statusWindowPlan) — painting is StatusVfxController's job and is
// verified live.

import { describe, expect, test } from "bun:test";
import { planStatusWindows, type WindowKind } from "../statusWindowPlan";
import type { PlayerId, Vec2, WorldState } from "../../../sim";

type P = Record<string, unknown>;

function stateWith(tick: number, players: Record<string, P>): WorldState {
  const ps: Record<string, unknown> = {};
  for (const [id, p] of Object.entries(players)) {
    ps[id] = { alive: true, vx: 0, ...p };
  }
  return { tick, players: ps } as unknown as WorldState;
}

const POS: Record<string, Vec2> = {
  a: { x: 100, y: 200 },
  b: { x: 500, y: 200 },
};
const getPosition = (id: PlayerId): Vec2 | undefined => POS[id as string];

const FIELD_BY_KIND: Record<Exclude<WindowKind, "fangs">, string> = {
  counter: "counterUntilTick",
  seal: "sealUntilTick",
  tithe: "titheUntilTick",
  measure: "measureUntilTick",
  surge: "speedBoostUntilTick",
  vuln: "vulnerabilityUntilTick",
  jam: "blockJammerUntilTick",
  fooled: "fooledUntilTick",
  aegis: "aegisShareUntilTick",
  resonance: "resonanceUntilTick",
};

describe("planStatusWindows — self-window body reads", () => {
  test("every tick-window kind plans a full-intensity read at the body while live", () => {
    for (const [kind, field] of Object.entries(FIELD_BY_KIND)) {
      const plan = planStatusWindows(stateWith(50, { a: { [field]: 140 } }), getPosition);
      expect(plan.length).toBe(1);
      expect(plan[0]!.kind).toBe(kind as WindowKind);
      expect(plan[0]!.id).toBe("a");
      expect(plan[0]!.pos).toEqual(POS.a!);
      expect(plan[0]!.intensity).toBe(1);
    }
  });

  test("a stale window (until <= tick) plans nothing", () => {
    for (const field of Object.values(FIELD_BY_KIND)) {
      const plan = planStatusWindows(stateWith(140, { a: { [field]: 140 } }), getPosition);
      expect(plan.length).toBe(0);
    }
  });

  test("intensity eases out over the window's final ~300ms (expiry tell)", () => {
    // 6 ticks ≈ 100ms remaining → intensity ≈ 1/3 for the default fade.
    const plan = planStatusWindows(
      stateWith(134, { a: { sealUntilTick: 140 } }),
      getPosition,
    );
    expect(plan[0]!.intensity).toBeGreaterThan(0);
    expect(plan[0]!.intensity).toBeLessThan(0.5);
  });

  test("counter's short fade keeps most of its ~500ms window at full intensity", () => {
    // 12 ticks ≈ 200ms remaining — inside the default 300ms fade but
    // OUTSIDE counter's 150ms fade, so the stance still reads full-on.
    const plan = planStatusWindows(
      stateWith(50, { a: { counterUntilTick: 62 } }),
      getPosition,
    );
    expect(plan[0]!.kind).toBe("counter");
    expect(plan[0]!.intensity).toBe(1);
  });

  test("a dead fighter plans nothing", () => {
    const plan = planStatusWindows(
      stateWith(50, { a: { alive: false, sealUntilTick: 140, titheUntilTick: 140 } }),
      getPosition,
    );
    expect(plan.length).toBe(0);
  });

  test("stacked windows on one fighter each plan (independent reads)", () => {
    const plan = planStatusWindows(
      stateWith(50, { a: { titheUntilTick: 140, veilUntilTick: 140, vulnerabilityUntilTick: 140 } }),
      getPosition,
    );
    // veilUntilTick belongs to veilReadPlan, not this planner.
    const kinds = plan.map((w) => w.kind).sort();
    expect(kinds).toEqual(["tithe", "vuln"]);
  });

  test("fangs plans with the banked charge count while unexpired, silent at zero", () => {
    const plan = planStatusWindows(
      stateWith(50, { a: { pendingLockCharges: 2, pendingLockExpiresAtTick: 140 } }),
      getPosition,
    );
    expect(plan.length).toBe(1);
    expect(plan[0]!.kind).toBe("fangs");
    expect(plan[0]!.count).toBe(2);
    const none = planStatusWindows(
      stateWith(50, { a: { pendingLockCharges: 0, pendingLockExpiresAtTick: 140 } }),
      getPosition,
    );
    expect(none.length).toBe(0);
    const expired = planStatusWindows(
      stateWith(150, { a: { pendingLockCharges: 2, pendingLockExpiresAtTick: 140 } }),
      getPosition,
    );
    expect(expired.length).toBe(0);
  });

  test("surge carries the mover's horizontal sign; near-stationary reads 0", () => {
    const moving = planStatusWindows(
      stateWith(50, { a: { speedBoostUntilTick: 140, vx: 180 } }),
      getPosition,
    );
    expect(moving[0]!.vxSign).toBe(1);
    const still = planStatusWindows(
      stateWith(50, { a: { speedBoostUntilTick: 140, vx: 4 } }),
      getPosition,
    );
    expect(still[0]!.vxSign).toBe(0);
  });

  test("a fighter with no live position is skipped", () => {
    const plan = planStatusWindows(
      stateWith(50, { ghost: { sealUntilTick: 140 } }),
      getPosition,
    );
    expect(plan.length).toBe(0);
  });
});
