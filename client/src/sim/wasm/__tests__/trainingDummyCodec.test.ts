// trainingDummy crosses the wasm bridge (2026-08-05 live regression).
//
// The venue lobby's practice dummies are DestructibleKind "trainingDummy"
// (types.ts, 2026-07-18) but the bridge's DESTRUCTIBLE_KINDS table and
// world_state.zig's enum never learned the value — invisible for weeks
// because the hangout TS pin kept the lobby off the wasm path entirely.
// The moment Track E1d lifted the pin, the live host threw
// `enum encode: unknown value "trainingDummy"` on every lobby tick and
// fell back to TS. This gate packs a dummy through a real wasm step and
// asserts the kind round-trips, so the codec can never silently lose a
// DestructibleKind again (the companion comptime enum in world_state.zig
// keeps the Zig side honest).

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadSimFromBytes } from "../loader";
import { EntityId, PlayerId, Tick } from "../../types";
import type { DestructibleEntity, WorldState } from "../../types";
import { applyWasmWorldStep } from "../worldWasmBackend";

// Same preload + fetch-stub harness as mergeIdentity.test.ts — the loader
// fetches sim.wasm, which bun test must serve from disk.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");
const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
await loadSimFromBytes(ab);
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

function fixtureWithDummy(): WorldState {
  const dummy: DestructibleEntity = {
    id: EntityId(202),
    kind: "trainingDummy",
    x: 9999, // far from anything — must survive the step untouched
    y: 9999,
    width: 26,
    height: 56,
    health: 100,
    explosive: false,
    flammable: false,
  };
  return {
    tick: Tick(0),
    rngState: 1,
    players: {} as Record<PlayerId, never>,
    projectiles: {},
    destructibles: { [dummy.id]: dummy } as Record<EntityId, DestructibleEntity>,
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

describe("trainingDummy wasm codec", () => {
  test("a venue practice dummy round-trips a real wasm step with kind intact", async () => {
    const state = fixtureWithDummy();
    const next = await applyWasmWorldStep(state, 16.667);
    const dummy = next.destructibles[EntityId(202)]!;
    expect(dummy).toBeDefined();
    expect(dummy.kind).toBe("trainingDummy");
    expect(dummy.health).toBe(100);
  });
});
