// Behavioral contract for the on-target mark-window reads (Track L,
// docs/legibility-audit.md — facet/judgment/read marks). Targets the pure
// Phaser-free planner (render/markReadPlan) — same convention as
// veilReadPlan.test.ts: the tested layer produces plain data, the Phaser
// painting is verified live.

import { describe, expect, test } from "bun:test";
import { planMarkReads } from "../markReadPlan";
import type { PlayerId, Vec2, WorldState } from "../../../sim";

type P = {
  alive?: boolean;
  facetTargetId?: string;
  facetMarkUntilTick?: number;
  judgmentTargetId?: string;
  judgmentMarkUntilTick?: number;
  readTargetId?: string;
  readMarkUntilTick?: number;
};

function stateWith(tick: number, players: Record<string, P>): WorldState {
  const ps: Record<string, unknown> = {};
  for (const [id, p] of Object.entries(players)) {
    ps[id] = { alive: p.alive ?? true, ...p };
  }
  return { tick, players: ps } as unknown as WorldState;
}

const POS: Record<string, Vec2> = {
  hunter: { x: 100, y: 200 },
  quarry: { x: 500, y: 200 },
  other: { x: 900, y: 200 },
};
const getPosition = (id: PlayerId): Vec2 | undefined => POS[id as string];

describe("planMarkReads — on-target mark-window reads", () => {
  test("a live facet mark plans one full-intensity read AT THE TARGET's body", () => {
    const plan = planMarkReads(
      stateWith(50, {
        hunter: { facetTargetId: "quarry", facetMarkUntilTick: 140 },
        quarry: {},
      }),
      getPosition,
    );
    expect(plan.length).toBe(1);
    expect(plan[0]!.kind).toBe("facet");
    expect(plan[0]!.targetId).toBe("quarry");
    expect(plan[0]!.pos).toEqual(POS.quarry!);
    expect(plan[0]!.intensity).toBe(1);
    expect(plan[0]!.stackIndex).toBe(0);
  });

  test("all three mark kinds plan; a triple-marked body stacks with distinct indices", () => {
    const plan = planMarkReads(
      stateWith(50, {
        a: { facetTargetId: "quarry", facetMarkUntilTick: 140 },
        b: { judgmentTargetId: "quarry", judgmentMarkUntilTick: 140 },
        c: { readTargetId: "quarry", readMarkUntilTick: 140 },
        quarry: {},
      }),
      getPosition,
    );
    expect(plan.length).toBe(3);
    const kinds = plan.map((m) => m.kind).sort();
    expect(kinds).toEqual(["facet", "judgment", "read"]);
    const indices = plan.map((m) => m.stackIndex).sort();
    expect(indices).toEqual([0, 1, 2]);
    for (const m of plan) expect(m.targetId).toBe("quarry");
  });

  test("intensity eases out over the window's final ~300ms (expiry tell)", () => {
    // 6 ticks left at ~16.67ms/tick ≈ 100ms remaining → intensity ≈ 1/3.
    const plan = planMarkReads(
      stateWith(134, {
        hunter: { readTargetId: "quarry", readMarkUntilTick: 140 },
        quarry: {},
      }),
      getPosition,
    );
    expect(plan.length).toBe(1);
    expect(plan[0]!.intensity).toBeGreaterThan(0);
    expect(plan[0]!.intensity).toBeLessThan(0.5);
  });

  test("a stale window (until <= tick) plans nothing — sim leaves the field in place", () => {
    const plan = planMarkReads(
      stateWith(140, {
        hunter: { judgmentTargetId: "quarry", judgmentMarkUntilTick: 140 },
        quarry: {},
      }),
      getPosition,
    );
    expect(plan.length).toBe(0);
  });

  test("a dead HUNTER's mark plans nothing (cannot be consumed)", () => {
    const plan = planMarkReads(
      stateWith(50, {
        hunter: { alive: false, facetTargetId: "quarry", facetMarkUntilTick: 140 },
        quarry: {},
      }),
      getPosition,
    );
    expect(plan.length).toBe(0);
  });

  test("a dead or missing TARGET plans nothing", () => {
    const dead = planMarkReads(
      stateWith(50, {
        hunter: { facetTargetId: "quarry", facetMarkUntilTick: 140 },
        quarry: { alive: false },
      }),
      getPosition,
    );
    expect(dead.length).toBe(0);
    const gone = planMarkReads(
      stateWith(50, {
        hunter: { facetTargetId: "vanished", facetMarkUntilTick: 140 },
      }),
      getPosition,
    );
    expect(gone.length).toBe(0);
  });

  test("razor-route's silent dash-cross tag (same read fields) plans at tag time", () => {
    // The tag write is eventless in the sim — the planner reads pure state,
    // so the mark appears the first frame readTargetId/readMarkUntilTick
    // land, with no SimEvent required. This IS the tag-time site read.
    const before = planMarkReads(stateWith(50, { hunter: {}, quarry: {} }), getPosition);
    expect(before.length).toBe(0);
    const after = planMarkReads(
      stateWith(51, {
        hunter: { readTargetId: "quarry", readMarkUntilTick: 351 },
        quarry: {},
      }),
      getPosition,
    );
    expect(after.length).toBe(1);
    expect(after[0]!.kind).toBe("read");
  });

  test("two hunters marking two different quarries each get stackIndex 0", () => {
    const plan = planMarkReads(
      stateWith(50, {
        a: { facetTargetId: "quarry", facetMarkUntilTick: 140 },
        b: { judgmentTargetId: "other", judgmentMarkUntilTick: 140 },
        quarry: {},
        other: {},
      }),
      getPosition,
    );
    expect(plan.length).toBe(2);
    for (const m of plan) expect(m.stackIndex).toBe(0);
  });
});
