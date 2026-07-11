// Death-FX contract producer: determinism + lifecycle + pooling.

import { describe, expect, test } from "bun:test";
import {
  makeDeathFxState,
  noteDeathEvents,
  produceDeathFx,
  produceDeathShards,
  produceSpawnFx,
  setDeathFxTarget,
  SOUL_ABSORB,
  SOUL_JOURNEY,
  SOUL_RELEASE,
  type ShardRenderModel,
  type SoulRenderModel,
  type UploadRenderModel,
} from "../renderContract";
import type { WorldState } from "../../../sim/types";

function fakeState(
  tick: number,
  players: Record<string, { x: number; y: number; alive?: boolean }>,
): WorldState {
  const ps: Record<string, unknown> = {};
  for (const [id, p] of Object.entries(players)) {
    ps[id] = { x: p.x, y: p.y, alive: p.alive ?? false };
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

describe("produceDeathShards", () => {
  test("shards split by damage share and home to the live attacker", () => {
    const st = makeDeathFxState();
    setDeathFxTarget(st, 1000, 500);
    const state = fakeState(50, {
      victim: { x: 300, y: 300 },
      a: { x: 600, y: 300, alive: true },
      b: { x: 100, y: 300, alive: true },
    });
    // a did 75, b did 25 → 9 shards ≈ 7/2 split.
    noteDeathEvents(state, [
      { t: "hit-confirmed", victimId: "victim", attackerId: "a", damage: 75 },
      { t: "hit-confirmed", victimId: "victim", attackerId: "b", damage: 25 },
      { t: "player-killed", victimId: "victim", killerId: "a" },
    ], st);
    const out: ShardRenderModel[] = [];
    expect(produceDeathShards(state, 16, st, out)).toBe(9);
    const toA = st.shards.filter((s) => s.active && s.targetId === "a").length;
    const toB = st.shards.filter((s) => s.active && s.targetId === "b").length;
    expect(toA).toBe(7);
    expect(toB).toBe(2);
    // Advance well past the hold: every shard must arrive (and ping) or be gone.
    for (let i = 0; i < 200; i++) produceDeathShards(state, 33.34, st, out);
    expect(st.shards.filter((s) => s.active).length).toBe(0);
  });

  test("kill with no ledger falls back 100% to the killer", () => {
    const st = makeDeathFxState();
    const state = fakeState(1, {
      v: { x: 0, y: 0 },
      k: { x: 200, y: 0, alive: true },
    });
    noteDeathEvents(state, [{ t: "player-killed", victimId: "v", killerId: "k" }], st);
    expect(st.shards.filter((s) => s.active && s.targetId === "k").length).toBe(9);
  });

  test("environmental death (no killer, no ledger) → soul only, no shards", () => {
    const st = makeDeathFxState();
    const state = fakeState(1, { v: { x: 0, y: 0 } });
    noteDeathEvents(state, [{ t: "player-killed", victimId: "v", killerId: null }], st);
    expect(st.shards.filter((s) => s.active).length).toBe(0);
    expect(st.souls.filter((s) => s.active).length).toBe(1);
  });
});

describe("produceSpawnFx", () => {
  test("alive transition and new player both trigger the upload; dead does not", () => {
    const st = makeDeathFxState();
    const out: UploadRenderModel[] = [];
    // First sight of a living player → upload (match start / mid-join).
    let state = fakeState(1, { p1: { x: 10, y: 10, alive: true } });
    expect(produceSpawnFx(state, 16, st, out)).toBe(1);
    // Still alive → no re-trigger, upload continues.
    expect(produceSpawnFx(state, 16, st, out)).toBe(1);
    // Dies → no upload; respawns → new upload.
    state = fakeState(2, { p1: { x: 10, y: 10, alive: false } });
    produceSpawnFx(state, 2000, st, out);
    expect(st.uploads.filter((u) => u.active).length).toBe(0);
    state = fakeState(3, { p1: { x: 40, y: 10, alive: true } });
    expect(produceSpawnFx(state, 16, st, out)).toBe(1);
    expect(out[0]!.x).toBe(40); // tracks the LIVE body position
  });
});
