// Long-horizon determinism canary. Runs 10,000 ticks of canned
// player physics through TS native AND Zig wasm (independent
// integrators) and asserts byte-identity at every tick.
//
// This catches the class of bugs that PASS short parity tests but
// accumulate ULP error over many minutes of play — exactly the
// failure mode the original "barely detects standing" jitter
// represented. Any drift here = the substrate is broken; the
// short tests just didn't run long enough to surface it.
//
// 10,000 ticks @ 60Hz = ~167 sim-seconds = ~2.8 minutes of
// gameplay. The script loops a 30-tick canned input pattern
// covering fall/run/jump/jetpack/crouch.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  buildStaticCache,
  setResolveMoveCachedBackend,
} from "../../collision";
import {
  freshPlayerMovementMemory,
  setStepPlayerBackend,
  stepPlayer,
  JETPACK_MAX_FUEL,
} from "../../player";
import type {
  PlatformDefinition,
  PlayerEntity,
  PlayerId,
  CharacterArchetype,
  InputSeq,
  InputBitfield,
} from "../../types";
import { loadSimFromBytes } from "../loader";
import { makeStepPlayerWasmBackend } from "../playerWasmBackend";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");

const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const sim = await loadSimFromBytes(ab);

const PLATFORMS: PlatformDefinition[] = [
  { id: "floor", kind: "floor", position: { x: 640, y: 620 }, size: { x: 1280, y: 40 } },
  { id: "p1", kind: "platform", position: { x: 400, y: 480 }, size: { x: 200, y: 18 } },
  { id: "cover", kind: "platform", position: { x: 800, y: 560 }, size: { x: 80, y: 80 } },
];
const cache = buildStaticCache(PLATFORMS, 1280, 720);
const DT_MS = 1000 / 60;

const Bit = {
  Left: 1 << 0,
  Right: 1 << 1,
  Down: 1 << 3,
  Jump: 1 << 4,
  Crouch: 1 << 5,
} as const;

// 30-tick canned input loop, repeats. Designed to exercise every
// branch in stepPlayer over a long run.
const INPUT_LOOP: InputBitfield[] = [
  // 0..4: free fall
  0, 0, 0, 0, 0,
  // 5..9: run right
  Bit.Right, Bit.Right, Bit.Right, Bit.Right, Bit.Right,
  // 10: jump
  Bit.Right | Bit.Jump,
  // 11..15: jetpack hold
  Bit.Right | Bit.Jump, Bit.Right | Bit.Jump, Bit.Right | Bit.Jump,
  Bit.Right | Bit.Jump, Bit.Right | Bit.Jump,
  // 16: release jump
  Bit.Right,
  // 17..21: keep running
  Bit.Right, Bit.Right, Bit.Right, Bit.Right, Bit.Right,
  // 22..23: crouch
  Bit.Crouch, Bit.Crouch,
  // 24..28: run left
  Bit.Left, Bit.Left, Bit.Left, Bit.Left, Bit.Left,
  // 29: idle
  0,
];

function makePlayer(): PlayerEntity {
  return {
    id: "p0" as PlayerId,
    characterId: "starter" as CharacterArchetype,
    x: 100, y: 0,
    vx: 0, vy: 0,
    aimX: 0, aimY: 0,
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

describe("long-horizon determinism canary", () => {
  test("10,000 ticks of TS-native vs Zig-wasm produce byte-identical state every tick", () => {
    setResolveMoveCachedBackend(null);
    setStepPlayerBackend(null);

    let tsP = makePlayer();
    let tsM = freshPlayerMovementMemory();

    setStepPlayerBackend(makeStepPlayerWasmBackend(sim));
    let waP = makePlayer();
    let waM = freshPlayerMovementMemory();

    const TICKS = 10_000;
    let prev: InputBitfield = 0;

    for (let tick = 0; tick < TICKS; tick++) {
      const curr = INPUT_LOOP[tick % INPUT_LOOP.length]!;

      // Drive TS native — backend swap is reversed for this leg.
      setStepPlayerBackend(null);
      const tsResult = stepPlayer(
        tsP, prev, curr, 0, 0, tsM, [], DT_MS,
        { collisionCache: cache },
      );
      tsP = tsResult.player;
      tsM = tsResult.memory;

      // Drive WASM — backend installed.
      setStepPlayerBackend(makeStepPlayerWasmBackend(sim));
      const waResult = stepPlayer(
        waP, prev, curr, 0, 0, waM, [], DT_MS,
        { collisionCache: cache },
      );
      waP = waResult.player;
      waM = waResult.memory;

      if (
        waP.x !== tsP.x ||
        waP.y !== tsP.y ||
        waP.vx !== tsP.vx ||
        waP.vy !== tsP.vy ||
        waP.crouching !== tsP.crouching ||
        (waP.jetpackFuel ?? -1) !== (tsP.jetpackFuel ?? -1) ||
        waM.coyoteMs !== tsM.coyoteMs ||
        waM.jumpBufferMs !== tsM.jumpBufferMs ||
        waM.groundedLastFrame !== tsM.groundedLastFrame ||
        waM.jetpackActive !== tsM.jetpackActive ||
        waResult.jumpedThisFrame !== tsResult.jumpedThisFrame
      ) {
        throw new Error(
          `tick ${tick} divergence:\n` +
          `  ts: x=${tsP.x} y=${tsP.y} vx=${tsP.vx} vy=${tsP.vy} grounded=${tsM.groundedLastFrame}\n` +
          `  wa: x=${waP.x} y=${waP.y} vx=${waP.vx} vy=${waP.vy} grounded=${waM.groundedLastFrame}`,
        );
      }
      prev = curr;
    }

    // Restore default for downstream tests.
    setStepPlayerBackend(null);

    // Sanity: after 10,000 ticks of mixed input, both impls produced
    // *something* — the player should have moved.
    expect(tsP.x).not.toBe(100);
  });
});
