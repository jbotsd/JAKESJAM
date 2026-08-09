// gospel N-AIM / E4 — the assisted aim dialect must decide identically in
// the core and in the browser.
//
// `sim/src/aim_dialect.zig` ports `game/input/touchAimAssist.ts` so the
// raylib shell and any future gamepad path resolve aim through the SAME
// code instead of growing a second, slightly-different assist. "Slightly
// different" is the whole risk: the assist picks its target by a strict
// `>` on a cosine, so a reordered expression changes WHO a player is
// nudged toward, and the blend ramp then changes by how much. Neither
// shows up as a crash; both show up as "aiming feels off on mobile".
//
// So this compares the real TS function against the wasm export over a
// grid of stick directions and target layouts.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadSimFromBytes } from "../loader";
import { packWorldState, WORLD_STATE_TOTAL_SIZE } from "../worldStateBridge";
import { assistTouchAim } from "../../../game/input/touchAimAssist";
import {
  EntityId,
  InputSeq,
  PlayerId,
  Tick,
  type PlayerEntity,
  type WorldState,
} from "../../types";

const bytes = await readFile(resolve(import.meta.dir, "..", "sim.wasm"));
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const sim = await loadSimFromBytes(ab);
const ex = sim.exports as unknown as {
  memory: WebAssembly.Memory;
  aim_assist_dir: (
    state: number, idx: number, ox: number, oy: number, sx: number, sy: number, out: number,
  ) => void;
  aim_resolve: (
    state: number, dialect: number, idx: number,
    ox: number, oy: number, rx: number, ry: number, reach: number, out: number,
  ) => void;
};

const outPtr = sim.statePtr + WORLD_STATE_TOTAL_SIZE + 512;
if (ex.memory.buffer.byteLength < outPtr + 4096) {
  ex.memory.grow(Math.ceil((outPtr + 4096 - ex.memory.buffer.byteLength) / 65536));
}
const readVec = (): { x: number; y: number } => {
  const dv = new DataView(ex.memory.buffer, outPtr, 16);
  return { x: dv.getFloat64(0, true), y: dv.getFloat64(8, true) };
};

function mkPlayer(id: string, x: number, y: number, over: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id: PlayerId(id), characterId: "balanced", x, y, vx: 0, vy: 0,
    aimX: x + 100, aimY: y, health: 100, shieldActive: false, crouching: false,
    alive: true, weaponId: "starter-pistol", cards: [], fireCooldownMs: 0,
    ammo: 0, abilityCharge: 0, lastProcessedInputSeq: InputSeq(0), ...over,
  };
}

function mkState(players: PlayerEntity[]): WorldState {
  const map: Record<PlayerId, PlayerEntity> = {};
  for (const p of players) map[p.id] = p;
  return {
    tick: Tick(0), rngState: 99 >>> 0, players: map,
    projectiles: {}, destructibles: {}, firePatches: {}, pickups: {}, satellites: {},
    round: {
      phase: "fighting", countdownRemainingMs: 90_000,
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      roundIndex: 0, winnerPlayerId: null,
    },
  };
}

/** Push state into the module and ask Zig for the assisted direction. */
function zigAssist(
  state: WorldState, localIndex: number, origin: { x: number; y: number }, stick: { x: number; y: number },
): { x: number; y: number } {
  new Uint8Array(ex.memory.buffer).set(packWorldState(state), sim.statePtr);
  ex.aim_assist_dir(sim.statePtr, localIndex, origin.x, origin.y, stick.x, stick.y, outPtr);
  return readVec();
}

const DIRS = [
  { x: 1, y: 0 }, { x: 0.966, y: 0.259 }, { x: 0.866, y: 0.5 }, { x: 0.5, y: 0.866 },
  { x: 0, y: 1 }, { x: -1, y: 0 }, { x: -0.707, y: -0.707 }, { x: 0.707, y: -0.707 },
];

describe("N-AIM — assisted dialect parity, Zig vs the browser", () => {
  test("no eligible target: both return the stick unchanged", () => {
    const me = mkPlayer("a", 0, 0);
    const state = mkState([me]);
    for (const d of DIRS) {
      const ts = assistTouchAim(state, PlayerId("a"), { x: 0, y: 0 }, d);
      const zig = zigAssist(state, 0, { x: 0, y: 0 }, d);
      expect(zig.x).toBeCloseTo(ts.x, 12);
      expect(zig.y).toBeCloseTo(ts.y, 12);
    }
  });

  test("a single enemy in the cone: identical blended direction", () => {
    const me = mkPlayer("a", 0, 0);
    let pulled = 0;
    for (const d of DIRS) {
      for (const dist of [120, 400, 880]) {
        // Place the enemy a few degrees off the stick direction so the
        // blend ramp is exercised, not just the on-axis case.
        const ang = Math.atan2(d.y, d.x) + 0.12;
        const foe = mkPlayer("b", Math.cos(ang) * dist, Math.sin(ang) * dist);
        const state = mkState([me, foe]);
        const ts = assistTouchAim(state, PlayerId("a"), { x: 0, y: 0 }, d);
        const zig = zigAssist(state, 0, { x: 0, y: 0 }, d);
        expect(zig.x).toBeCloseTo(ts.x, 12);
        expect(zig.y).toBeCloseTo(ts.y, 12);
        if (Math.abs(ts.x - d.x) > 1e-9 || Math.abs(ts.y - d.y) > 1e-9) pulled += 1;
      }
    }
    // Vacuity guard: if the assist never actually pulled, every comparison
    // above was "stick === stick" and proved nothing about the blend.
    expect(pulled).toBeGreaterThan(0);
  });

  test("two candidates: both pick the same one (nearest to crosshair, not nearest by distance)", () => {
    // The tiebreak is the interesting part — a CLOSE enemy off-axis must
    // lose to a FAR one the player is actually pointing at.
    const me = mkPlayer("a", 0, 0);
    const onAxisFar = mkPlayer("b", 800, 0);
    const offAxisNear = mkPlayer("c", 100, 40);
    const state = mkState([me, onAxisFar, offAxisNear]);
    const stick = { x: 1, y: 0 };
    const ts = assistTouchAim(state, PlayerId("a"), { x: 0, y: 0 }, stick);
    const zig = zigAssist(state, 0, { x: 0, y: 0 }, stick);
    expect(zig.x).toBeCloseTo(ts.x, 12);
    expect(zig.y).toBeCloseTo(ts.y, 12);
  });

  test("the boundaries agree: dead players, out of range, outside the cone", () => {
    const me = mkPlayer("a", 0, 0);
    const cases: Array<[string, PlayerEntity]> = [
      ["dead", mkPlayer("b", 300, 0, { alive: false })],
      ["zero health", mkPlayer("b", 300, 0, { health: 0 })],
      ["out of range", mkPlayer("b", 1200, 0)],
      ["outside the cone", mkPlayer("b", 300, 300)],
      ["on top of us", mkPlayer("b", 0.4, 0)],
    ];
    for (const [label, foe] of cases) {
      const state = mkState([me, foe]);
      const ts = assistTouchAim(state, PlayerId("a"), { x: 0, y: 0 }, { x: 1, y: 0 });
      const zig = zigAssist(state, 0, { x: 0, y: 0 }, { x: 1, y: 0 });
      expect({ label, x: zig.x, y: zig.y }).toEqual({ label, x: ts.x, y: ts.y });
      // Each of these must leave the stick untouched — that IS the rule.
      expect(ts.x).toBeCloseTo(1, 12);
    }
  });

  test("a zero-length stick is returned untouched by both", () => {
    const state = mkState([mkPlayer("a", 0, 0), mkPlayer("b", 300, 0)]);
    const ts = assistTouchAim(state, PlayerId("a"), { x: 0, y: 0 }, { x: 0, y: 0 });
    const zig = zigAssist(state, 0, { x: 0, y: 0 }, { x: 0, y: 0 });
    expect([zig.x, zig.y]).toEqual([ts.x, ts.y]);
  });
});

describe("N-AIM — the exact dialect is genuinely a no-op", () => {
  test("mouse aim passes through untransformed even with a target in the cone", () => {
    // The design rule this pins: "Touch-only — mouse aim is never
    // transformed." If `exact` ever started assisting, mouse players would
    // silently gain aim assist and nothing else would notice.
    const state = mkState([mkPlayer("a", 0, 0), mkPlayer("b", 300, 0)]);
    new Uint8Array(ex.memory.buffer).set(packWorldState(state), sim.statePtr);
    ex.aim_resolve(sim.statePtr, 0 /* exact */, 0, 0, 0, 1234, 567, 420, outPtr);
    expect(readVec()).toEqual({ x: 1234, y: 567 });
  });

  test("the assisted dialect projects out to reach from the origin", () => {
    const state = mkState([mkPlayer("a", 0, 0)]);
    new Uint8Array(ex.memory.buffer).set(packWorldState(state), sim.statePtr);
    ex.aim_resolve(sim.statePtr, 1 /* assisted */, 0, 10, 20, 1, 0, 420, outPtr);
    const got = readVec();
    expect(got.x).toBeCloseTo(430, 9);
    expect(got.y).toBeCloseTo(20, 9);
  });
});
