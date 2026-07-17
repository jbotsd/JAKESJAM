// True-slope parity: TS V8 vs Zig wasm, bit-exact. Drives a slope-crossing
// trajectory (approach → foot-point grounding → magnitude-preserving
// tangent ride → crest launch → landing, plus a mid-slope jump) through
// BOTH impls for BOTH grades in BOTH directions, asserting byte-identical
// player state at every tick.
//
// The wasm side goes through the PRODUCTION packing path —
// makeStepPlayerWasmBackend — which writes statics AND the slope statics
// (world_state_set_slopes, player.zig module-level) per call, exactly as
// live prediction does. So this also gates the transport: the f64 bits the
// wasm pass reads are the ones deriveSlopeStatics produced.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { buildStaticCache } from "../../collision";
import {
  freshPlayerMovementMemory,
  stepPlayer,
  setStepPlayerBackend,
  JETPACK_MAX_FUEL,
  type PlayerMovementMemory,
} from "../../player";
import type {
  CharacterArchetype,
  InputBitfield,
  InputSeq,
  PlayerEntity,
  PlayerId,
  SlopeDefinition,
} from "../../types";
import { loadSimFromBytes } from "../loader";
import { makeStepPlayerWasmBackend } from "../playerWasmBackend";

setStepPlayerBackend(null); // TS side must be the native impl

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");

const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const sim = await loadSimFromBytes(ab);
const wasmStep = makeStepPlayerWasmBackend(sim);

const DT_MS = 1000 / 60;
const Bit = { Left: 1 << 0, Right: 1 << 1, Jump: 1 << 4 } as const;

function makePlayer(x: number, y: number): PlayerEntity {
  return {
    id: "p0" as PlayerId,
    characterId: "starter" as CharacterArchetype,
    x, y,
    vx: 0, vy: 0,
    aimX: x, aimY: y,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "scrap-rifle",
    cards: [],
    fireCooldownMs: 0,
    ammo: 12,
    abilityCharge: 0,
    lastProcessedInputSeq: 0 as InputSeq,
    jetpackFuel: JETPACK_MAX_FUEL,
  };
}

type Scenario = {
  name: string;
  slope: SlopeDefinition;
  startX: number;
  toward: InputBitfield; // input that runs UP the slope
};

// Floor top at 600 across 1280; slope bases meet the floor.
const SCENARIOS: Scenario[] = [
  {
    name: "2:1 ascending right",
    slope: { id: "s", base: { x: 500, y: 600 }, run: 240, grade: "2:1", dir: 1 },
    startX: 260,
    toward: Bit.Right,
  },
  {
    name: "2:1 ascending left",
    slope: { id: "s", base: { x: 780, y: 600 }, run: 240, grade: "2:1", dir: -1 },
    startX: 1020,
    toward: Bit.Left,
  },
  {
    name: "1:1 ascending right",
    slope: { id: "s", base: { x: 500, y: 600 }, run: 160, grade: "1:1", dir: 1 },
    startX: 260,
    toward: Bit.Right,
  },
  {
    name: "1:1 ascending left",
    slope: { id: "s", base: { x: 780, y: 600 }, run: 160, grade: "1:1", dir: -1 },
    startX: 1020,
    toward: Bit.Left,
  },
];

function buildScript(toward: InputBitfield): Array<{ prev: InputBitfield; curr: InputBitfield }> {
  const ticks: Array<{ prev: InputBitfield; curr: InputBitfield }> = [];
  let prev: InputBitfield = 0;
  const push = (curr: InputBitfield) => {
    ticks.push({ prev, curr });
    prev = curr;
  };
  for (let i = 0; i < 10; i++) push(0); // settle on the floor
  for (let i = 0; i < 25; i++) push(toward); // approach + start the climb
  push(toward | Bit.Jump); // mid-slope jump (one-way leave)
  for (let i = 0; i < 12; i++) push(toward | Bit.Jump);
  for (let i = 0; i < 40; i++) push(toward); // land back on, ride to crest, launch
  for (let i = 0; i < 30; i++) push(0); // ballistic fall + settle
  const back = toward === Bit.Right ? Bit.Left : Bit.Right;
  for (let i = 0; i < 40; i++) push(back); // walk back DOWN the slope (glue)
  return ticks;
}

describe("slope parity (TS V8 vs Zig wasm) — both grades, both directions", () => {
  for (const sc of SCENARIOS) {
    test(`${sc.name}: byte-identical every tick across the crossing`, () => {
      const cache = buildStaticCache(
        [{ id: "floor", kind: "floor", position: { x: 640, y: 620 }, size: { x: 1280, y: 40 } }],
        1280, 720,
        [sc.slope],
      );
      const script = buildScript(sc.toward);

      let tsP = makePlayer(sc.startX, 572);
      let tsM = freshPlayerMovementMemory();
      let wP = makePlayer(sc.startX, 572);
      let wM: PlayerMovementMemory = freshPlayerMovementMemory();

      let groundedOnSlopeTicks = 0;
      for (let t = 0; t < script.length; t++) {
        const { prev, curr } = script[t]!;
        const aimX = tsP.x + 100;
        const aimY = tsP.y;
        const ts = stepPlayer(tsP, prev, curr, aimX, aimY, tsM, [], DT_MS, {
          collisionCache: cache,
        });
        const w = wasmStep(wP, prev, curr, aimX, aimY, wM, [], DT_MS, {
          collisionCache: cache,
        });
        tsP = ts.player; tsM = ts.memory;
        wP = w.player; wM = w.memory;

        // Bit-exact positions + velocities + movement memory, every tick.
        expect(wP.x).toBe(tsP.x);
        expect(wP.y).toBe(tsP.y);
        expect(wP.vx).toBe(tsP.vx);
        expect(wP.vy).toBe(tsP.vy);
        expect(wP.crouching).toBe(tsP.crouching);
        expect(wM.groundedLastFrame).toBe(tsM.groundedLastFrame);
        expect(wM.touchingWallDir).toBe(tsM.touchingWallDir);
        expect(wM.coyoteMs).toBe(tsM.coyoteMs);
        expect(wM.jumpBufferMs).toBe(tsM.jumpBufferMs);
        expect(w.jumpedThisFrame).toBe(ts.jumpedThisFrame);

        // Track that the trajectory genuinely exercised the slope pass
        // (grounded with a non-trivial vertical tangent component).
        if (tsM.groundedLastFrame && Math.abs(tsP.vy) > 50) groundedOnSlopeTicks++;
      }
      // The scenario must actually cross the slope — a vacuous parity pass
      // (never grounding on it) would prove nothing.
      expect(groundedOnSlopeTicks).toBeGreaterThan(10);
    });
  }
});
