// Behavioral contract for the Syzygist entanglement construct. Targets the pure
// Phaser-free planner (render/entanglementPlan) — same convention as
// render/__tests__/deathFx.test.ts, where the tested layer produces plain data
// and the Phaser painting is verified live. (docs/presentation-overhaul-goal.md
// P0.)

import { describe, expect, test } from "bun:test";
import {
  makeEntanglementMemo,
  planEntanglement,
} from "../../render/entanglementPlan";
import type { CharacterArchetype, PlayerId, Vec2, WorldState } from "../../../sim";

function stateWith(
  tick: number,
  players: Record<string, { characterId: CharacterArchetype; alive?: boolean; markUntil?: number }>,
): WorldState {
  const ps: Record<string, unknown> = {};
  for (const [id, p] of Object.entries(players)) {
    ps[id] = {
      alive: p.alive ?? true,
      characterId: p.characterId,
      focusHexMarkUntilTick: p.markUntil,
    };
  }
  return { tick, players: ps } as unknown as WorldState;
}

// shielded archetype = priest = Syzygist (data/cardTypes ARCHETYPE_CLASS_ID).
const resolveClassId = (cid: CharacterArchetype): string =>
  cid === "shielded" ? "priest" : "wizard";

const POS: Record<string, Vec2> = {
  priest: { x: 100, y: 100 },
  priest2: { x: 900, y: 100 },
  victim: { x: 340, y: 100 },
};
const getPosition = (id: PlayerId): Vec2 | undefined => POS[id as string];

describe("planEntanglement — Syzygist entanglement", () => {
  test("priest + marked victim → a tether and a bind burst on the catch", () => {
    const memo = makeEntanglementMemo();
    const state = stateWith(50, {
      priest: { characterId: "shielded" },
      victim: { characterId: "balanced", markUntil: 200 },
    });
    const plan = planEntanglement(state, 16, getPosition, resolveClassId, memo);
    expect(plan.tethers.length).toBe(1); // fires immediately (cadence primed)
    expect(plan.tethers[0]!.from).toEqual(POS.priest!); // anchored at the priest
    expect(plan.tethers[0]!.to).toEqual(POS.victim!);
    expect(plan.binds.length).toBe(1); // the mark catching
    expect(plan.snaps.length).toBe(0);
  });

  test("no priest present → a marked victim plans nothing (needs an anchor)", () => {
    const memo = makeEntanglementMemo();
    const state = stateWith(50, {
      victim: { characterId: "balanced", markUntil: 200 },
      other: { characterId: "balanced" },
    });
    const plan = planEntanglement(state, 16, getPosition, resolveClassId, memo);
    expect(plan.tethers.length).toBe(0);
    expect(plan.binds.length).toBe(0);
  });

  test("unmarked fighters near a priest → nothing (mark is the trigger)", () => {
    const memo = makeEntanglementMemo();
    const state = stateWith(50, {
      priest: { characterId: "shielded" },
      victim: { characterId: "balanced" }, // no mark
    });
    const plan = planEntanglement(state, 16, getPosition, resolveClassId, memo);
    expect(plan.tethers.length).toBe(0);
    expect(plan.binds.length).toBe(0);
  });

  test("held tether feeds a devotion mote (victim → priest) after the cadence", () => {
    const memo = makeEntanglementMemo();
    const state = stateWith(50, {
      priest: { characterId: "shielded" },
      victim: { characterId: "balanced", markUntil: 999 },
    });
    let motes = 0;
    let tethers = 0;
    for (let i = 0; i < 16; i++) {
      const plan = planEntanglement(state, 16, getPosition, resolveClassId, memo);
      motes += plan.motes.length;
      tethers += plan.tethers.length;
    }
    expect(motes).toBeGreaterThanOrEqual(1); // ~250ms > 150ms mote cadence
    expect(tethers).toBeGreaterThanOrEqual(2); // re-emitted, not one-shot
    // The mote flows home: from victim, to priest.
    // (direction checked once a mote exists)
    const memo2 = makeEntanglementMemo();
    let dirChecked = false;
    for (let i = 0; i < 16 && !dirChecked; i++) {
      const plan = planEntanglement(state, 16, getPosition, resolveClassId, memo2);
      if (plan.motes.length > 0) {
        expect(plan.motes[0]!.from).toEqual(POS.victim!);
        expect(plan.motes[0]!.to).toEqual(POS.priest!);
        dirChecked = true;
      }
    }
    expect(dirChecked).toBe(true);
  });

  test("mark expiring plans a snap burst, then the thread stops", () => {
    const memo = makeEntanglementMemo();
    const held = stateWith(50, {
      priest: { characterId: "shielded" },
      victim: { characterId: "balanced", markUntil: 200 },
    });
    planEntanglement(held, 16, getPosition, resolveClassId, memo);

    // Mark now expired (untilTick <= tick): pair goes un-live → snap.
    const released = stateWith(250, {
      priest: { characterId: "shielded" },
      victim: { characterId: "balanced", markUntil: 200 },
    });
    const snapPlan = planEntanglement(released, 16, getPosition, resolveClassId, memo);
    expect(snapPlan.snaps.length).toBe(1);
    expect(snapPlan.snaps[0]!).toEqual(POS.victim!); // fired at last known spot
    expect(snapPlan.tethers.length).toBe(0);

    // A further frame plans nothing (the pair is gone).
    const gonePlan = planEntanglement(released, 16, getPosition, resolveClassId, memo);
    expect(gonePlan.tethers.length).toBe(0);
    expect(gonePlan.snaps.length).toBe(0);
  });

  test("two priests → victim binds to the NEAREST (proximity attribution)", () => {
    const memo = makeEntanglementMemo();
    const state = stateWith(50, {
      priest: { characterId: "shielded" }, // (100,100) — nearer
      priest2: { characterId: "shielded" }, // (900,100)
      victim: { characterId: "balanced", markUntil: 200 }, // (340,100)
    });
    const plan = planEntanglement(state, 16, getPosition, resolveClassId, memo);
    expect(plan.tethers.length).toBe(1);
    expect(plan.tethers[0]!.from).toEqual(POS.priest!); // nearest wins
  });

  test("dead priest or dead victim → no tether", () => {
    const memo = makeEntanglementMemo();
    const state = stateWith(50, {
      priest: { characterId: "shielded", alive: false },
      victim: { characterId: "balanced", markUntil: 200 },
    });
    const plan = planEntanglement(state, 16, getPosition, resolveClassId, memo);
    expect(plan.tethers.length).toBe(0);
  });
});
