// Layer 3 (long-horizon canary) gate per game-qa skill.
// Hypothesis: mergeUnpacked preserves referential identity for
// entities whose scalar fields didn't change between ticks. The
// renderer's identity-based change detection (procedural rig
// bone draw, sprite pool reuse) depends on this — without it,
// we get the rig-streak bug from the 2026-05-05 user playtest.
//
// Falsifies: the regression where mergeUnpacked rebuilds every
// entity object every tick → renderer treats every entity as
// new → re-draws every limb / sprite every frame.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import { applyWasmWorldStep } from "../worldWasmBackend";
import {
  EntityId,
  PlayerId,
  Tick,
  type DestructibleEntity,
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

function makeFixture(): WorldState {
  const dest: DestructibleEntity = {
    id: EntityId(101),
    kind: "barrel",
    x: 9999, // far from any projectile, won't take damage
    y: 9999,
    width: 32,
    height: 32,
    health: 100,
    explosive: true,
    flammable: false,
  };
  return {
    tick: Tick(0),
    rngState: 1,
    players: {} as Record<PlayerId, never>,
    projectiles: {},
    destructibles: { [dest.id]: dest } as Record<EntityId, DestructibleEntity>,
    firePatches: {},
    pickups: {},
    satellites: {},
    round: {
      phase: "fighting",
      countdownRemainingMs: 30_000,
      scores: {},
      roundIndex: 1,
      winnerPlayerId: null,
    },
  };
}

describe("mergeUnpacked identity preservation (game-qa layer 3)", () => {
  test("destructible reference is preserved when health doesn't change", async () => {
    const state = makeFixture();
    const dest1 = state.destructibles[EntityId(101)]!;
    const next1 = await applyWasmWorldStep(state, 16.667);
    const dest2 = next1.destructibles[EntityId(101)]!;
    // Health didn't change (no projectile in range), so the merged
    // record should be the SAME OBJECT reference as the input.
    expect(dest2).toBe(dest1);
  });

  test("destructible reference replaced when health changes", async () => {
    const state = makeFixture();
    state.destructibles[EntityId(101)]!.x = 100;
    state.destructibles[EntityId(101)]!.y = 100;
    state.projectiles[EntityId(1) as EntityId] = {
      id: EntityId(1),
      ownerId: null,
      x: 100,
      y: 100,
      vx: 0,
      vy: 0,
      shape: "circle",
      radius: 6,
      damage: 25,
      lifetimeMs: 1000,
      pathing: "straight",
      element: "neutral",
      bouncesRemaining: 0,
      pierceRemaining: 0,
    };
    const dest1 = state.destructibles[EntityId(101)]!;
    const next1 = await applyWasmWorldStep(state, 16.667);
    const dest2 = next1.destructibles[EntityId(101)]!;
    // Health did change (projectile hit), so different reference.
    expect(dest2).not.toBe(dest1);
    expect(dest2.health).toBeLessThan(dest1.health);
  });

  test("over 60 ticks, idle entity keeps stable reference across most frames", async () => {
    let state = makeFixture();
    const start = state.destructibles[EntityId(101)]!;
    let stableTicks = 0;
    for (let i = 0; i < 60; i++) {
      state = await applyWasmWorldStep(state, 16.667);
      if (state.destructibles[EntityId(101)] === start) stableTicks++;
    }
    // Idle destructible should keep the same reference for the
    // whole run. <60 = the merge is creating new objects on
    // unchanged state → renderer churn.
    expect(stableTicks).toBe(60);
  });
});
