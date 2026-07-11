// Death-FX contract producer: determinism + lifecycle + pooling.

import { describe, expect, test } from "bun:test";
import {
  makeDeathFxState,
  noteDeathEvents,
  produceDeathFx,
  setDeathFxTarget,
  SOUL_ABSORB,
  SOUL_JOURNEY,
  SOUL_RELEASE,
  type SoulRenderModel,
} from "../renderContract";
import type { WorldState } from "../../../sim/types";

function fakeState(tick: number, players: Record<string, { x: number; y: number }>): WorldState {
  const ps: Record<string, unknown> = {};
  for (const [id, p] of Object.entries(players)) {
    ps[id] = { x: p.x, y: p.y, alive: false };
  }
  return { tick, players: ps } as unknown as WorldState;
}

const KILL = (victimId: string) => [{ t: "player-killed", victimId }];

function run(deltas: number[], tick = 100): SoulRenderModel[][] {
  const st = makeDeathFxState();
  setDeathFxTarget(st, 1000, 500);
  const state = fakeState(tick, { p1: { x: 200, y: 800 } });
  noteDeathEvents(state, KILL("p1"), st);
  const frames: SoulRenderModel[][] = [];
  const out: SoulRenderModel[] = [];
  for (const d of deltas) {
    const n = produceDeathFx(state, d, st, out);
    frames.push(
      Array.from({ length: n }, (_, i) => JSON.parse(JSON.stringify(out[i])) as SoulRenderModel),
    );
  }
  return frames;
}

describe("produceDeathFx", () => {
  test("two identical runs trace identical souls (determinism)", () => {
    const deltas = Array.from({ length: 90 }, () => 33.34);
    const a = run(deltas);
    const b = run(deltas);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("lifecycle: release → journey → absorb → gone", () => {
    const st = makeDeathFxState();
    setDeathFxTarget(st, 1000, 500);
    const state = fakeState(7, { p1: { x: 200, y: 800 } });
    noteDeathEvents(state, KILL("p1"), st);
    const out: SoulRenderModel[] = [];

    expect(produceDeathFx(state, 100, st, out)).toBe(1);
    expect(out[0]!.stage).toBe(SOUL_RELEASE);

    produceDeathFx(state, 1000, st, out); // ~1.1s in → journey
    expect(out[0]!.stage).toBe(SOUL_JOURNEY);

    produceDeathFx(state, 1400, st, out); // ~2.5s in → absorb, at the motif
    expect(out[0]!.stage).toBe(SOUL_ABSORB);
    expect(out[0]!.x).toBe(1000);
    expect(out[0]!.y).toBe(500);
    expect(out[0]!.absorbT).toBeGreaterThan(0);

    expect(produceDeathFx(state, 2000, st, out)).toBe(0); // expired
  });

  test("journey ends where absorb begins (path continuity at the motif)", () => {
    const st = makeDeathFxState();
    setDeathFxTarget(st, 1000, 500);
    const state = fakeState(7, { p1: { x: 200, y: 800 } });
    noteDeathEvents(state, KILL("p1"), st);
    const out: SoulRenderModel[] = [];
    produceDeathFx(state, 2265, st, out); // 5ms before journey end
    const dx = out[0]!.x - 1000;
    const dy = out[0]!.y - 500;
    expect(Math.hypot(dx, dy)).toBeLessThan(8);
  });

  test("unknown victims and other events are ignored; pool recycles", () => {
    const st = makeDeathFxState();
    setDeathFxTarget(st, 0, 0);
    const state = fakeState(1, { p1: { x: 0, y: 0 } });
    noteDeathEvents(state, [{ t: "hit-confirmed", victimId: "p1" }], st);
    noteDeathEvents(state, KILL("ghost"), st);
    const out: SoulRenderModel[] = [];
    expect(produceDeathFx(state, 16, st, out)).toBe(0);
    // 20 kills of the same corpse → capped at pool size, no throw.
    for (let i = 0; i < 20; i++) noteDeathEvents(state, KILL("p1"), st);
    expect(produceDeathFx(state, 16, st, out)).toBeLessThanOrEqual(16);
  });
});
