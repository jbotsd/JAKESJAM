// V6b — determinism canary. Runs two parallel evolutions of the
// J0 shim from the same starting state + identical dt sequence;
// asserts the final byte-encoded WorldState matches exactly.
// Catches the class of bug where step_world has a hidden source
// of nondeterminism (uninitialized field, host clock leak,
// rng-state leak).

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import { applyWasmWorldStep } from "../worldWasmBackend";
import { packWorldState } from "../worldStateBridge";
import {
  EntityId,
  PlayerId,
  Tick,
  type DestructibleEntity,
  type FireEntity,
  type ProjectileEntity,
  type WorldState,
} from "../../types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");

const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const preloaded = await loadSimFromBytes(ab);
void preloaded;

(globalThis as { fetch: typeof fetch }).fetch = ((
  input: RequestInfo | URL,
) => {
  const url = input instanceof URL ? input.toString() : String(input);
  if (url.endsWith("sim.wasm")) {
    return Promise.resolve(
      new Response(ab as ArrayBuffer, {
        headers: { "Content-Type": "application/wasm" },
      }),
    );
  }
  throw new Error(`unexpected fetch in test: ${url}`);
}) as unknown as typeof fetch;

function makeSeededFixture(seed: number): WorldState {
  // Cheap PRNG to vary fixture per call without locking us to a
  // particular RNG impl (we don't need bit-exactness across
  // seeds — only across runs of the SAME seed).
  let s = seed >>> 0;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s;
  };

  const projectiles: Record<EntityId, ProjectileEntity> = {} as Record<
    EntityId,
    ProjectileEntity
  >;
  for (let i = 0; i < 30; i++) {
    const id = EntityId(1000 + i);
    projectiles[id] = {
      id,
      ownerId: null,
      x: (next() % 800) - 400,
      y: (next() % 600) - 300,
      vx: 0,
      vy: 0,
      shape: "circle",
      radius: 5 + (next() % 5),
      damage: 10 + (next() % 30),
      lifetimeMs: 1000 + (next() % 4000),
      pathing: "straight",
      element: "neutral",
      bouncesRemaining: 0,
      pierceRemaining: 0,
      stickyFuseMs: i % 7 === 0 ? 100 + (next() % 500) : undefined,
    };
  }

  const destructibles: Record<EntityId, DestructibleEntity> = {} as Record<
    EntityId,
    DestructibleEntity
  >;
  for (let i = 0; i < 10; i++) {
    const id = EntityId(2000 + i);
    destructibles[id] = {
      id,
      kind: "barrel",
      x: (next() % 800) - 400,
      y: (next() % 600) - 300,
      width: 32,
      height: 32,
      health: 50 + (next() % 100),
      explosive: i % 2 === 0,
      flammable: i % 3 === 0,
    };
  }

  const firePatches: Record<EntityId, FireEntity> = {} as Record<
    EntityId,
    FireEntity
  >;
  for (let i = 0; i < 5; i++) {
    const id = EntityId(3000 + i);
    firePatches[id] = {
      id,
      x: 0,
      y: 0,
      radius: 32,
      remainingMs: 200 + (next() % 1500),
      ownerId: null,
      damagePerSecond: 10 + (next() % 10),
    };
  }

  return {
    tick: Tick(0),
    rngState: seed >>> 0,
    players: {} as Record<PlayerId, never>,
    projectiles,
    destructibles,
    firePatches,
    pickups: {},
    satellites: {},
    round: {
      phase: "fighting",
      countdownRemainingMs: 30_000,
      scores: {},
      roundIndex: 1,
      winnerPlayerId: null,
    },
    chaosModifierIds: ["low-gravity", "max-recoil"],
  };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): {
  equal: boolean;
  firstDivergenceAt?: number;
  aByte?: number;
  bByte?: number;
} {
  if (a.byteLength !== b.byteLength) {
    return {
      equal: false,
      firstDivergenceAt: -1,
      aByte: a.byteLength,
      bByte: b.byteLength,
    };
  }
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) {
      return { equal: false, firstDivergenceAt: i, aByte: a[i], bByte: b[i] };
    }
  }
  return { equal: true };
}

const STEP_MS = 1000 / 60;
const TICKS = 200;

describe("wasm orchestrator determinism (Phase V6b)", () => {
  test("same starting state + dt → identical final WorldState bytes", async () => {
    const seed = 0xc0ffee;
    let stateA = makeSeededFixture(seed);
    let stateB = makeSeededFixture(seed);

    for (let i = 0; i < TICKS; i++) {
      stateA = await applyWasmWorldStep(stateA, STEP_MS);
      stateB = await applyWasmWorldStep(stateB, STEP_MS);
    }

    const bufA = packWorldState(stateA);
    const bufB = packWorldState(stateB);
    const cmp = bytesEqual(bufA, bufB);
    if (!cmp.equal) {
      throw new Error(
        `Determinism break: first divergence at byte ${cmp.firstDivergenceAt}; A=${cmp.aByte} B=${cmp.bByte}`,
      );
    }
    expect(cmp.equal).toBe(true);
    expect(stateA.tick).toBe(Tick(TICKS));
  });

  test("different seeds produce different final states (sanity)", async () => {
    let stateA = makeSeededFixture(0xc0ffee);
    let stateB = makeSeededFixture(0xdeadbeef);

    for (let i = 0; i < 50; i++) {
      stateA = await applyWasmWorldStep(stateA, STEP_MS);
      stateB = await applyWasmWorldStep(stateB, STEP_MS);
    }

    const bufA = packWorldState(stateA);
    const bufB = packWorldState(stateB);
    const cmp = bytesEqual(bufA, bufB);
    expect(cmp.equal).toBe(false);
  });

  test("interleaved A/B/A/B sequence is identical to sequential A then B", async () => {
    const seed = 0x12345;

    // Sequential.
    let seqA = makeSeededFixture(seed);
    let seqB = makeSeededFixture(seed);
    for (let i = 0; i < 50; i++) seqA = await applyWasmWorldStep(seqA, STEP_MS);
    for (let i = 0; i < 50; i++) seqB = await applyWasmWorldStep(seqB, STEP_MS);

    // Interleaved.
    let intA = makeSeededFixture(seed);
    let intB = makeSeededFixture(seed);
    for (let i = 0; i < 50; i++) {
      intA = await applyWasmWorldStep(intA, STEP_MS);
      intB = await applyWasmWorldStep(intB, STEP_MS);
    }

    const bufSeqA = packWorldState(seqA);
    const bufSeqB = packWorldState(seqB);
    const bufIntA = packWorldState(intA);
    const bufIntB = packWorldState(intB);

    expect(bytesEqual(bufSeqA, bufIntA).equal).toBe(true);
    expect(bytesEqual(bufSeqB, bufIntB).equal).toBe(true);
  });
});
