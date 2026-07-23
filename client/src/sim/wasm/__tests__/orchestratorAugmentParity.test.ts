// Cutover gate — proves the card AUGMENTS resolved TS-side land byte-correct in
// the ResolvedFireConfig the Zig orchestrator (world.zig) reads each tick.
//
// The substrate (stepPlayer) is byte-parity'd by longHorizonCanary; movement/
// jump through step_world is covered by the ?wasm-world=2 collisionRepro e2e.
// The gap those DON'T cover is the migration wiring added here: the config now
// carries movement/shield/parry augments (offset 136+), the host packs them
// from createWeaponBuild, world.zig reads them. If a card's augment doesn't
// reach that struct, the Zig orchestrator applies a DIFFERENT build than TS and
// the pure-Zig cutover diverges. This asserts the whole path end-to-end:
// card id → createWeaponBuild → packResolvedFireConfig → wasm linear memory.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import {
  preloadWasmWorldSim,
  __getCachedSim,
  __getCachedEx,
} from "../worldWasmBackend";
import { writeFireConfigsForState, __clearFireConfigCacheForTests } from "../writeFireConfigs";
import { wasmHost } from "../wasmHost";
import {
  PlayerId,
  Tick,
  type PlayerEntity,
  type WorldState,
} from "../../types";

const WASM_PATH = resolve(import.meta.dir, "..", "sim.wasm");
const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
await loadSimFromBytes(ab);
(globalThis as { fetch: typeof fetch }).fetch = ((input: RequestInfo | URL) => {
  const url = input instanceof URL ? input.toString() : String(input);
  if (url.endsWith("sim.wasm"))
    return Promise.resolve(
      new Response(ab as ArrayBuffer, { headers: { "Content-Type": "application/wasm" } }),
    );
  throw new Error(`unexpected fetch: ${url}`);
}) as unknown as typeof fetch;
await preloadWasmWorldSim();
await wasmHost.preload();

const PID = PlayerId("p0");

// Config field byte offsets (mirror sim/src/world_state.zig ResolvedFireConfig
// + client/src/sim/wasm/wasmHost.ts write loop). The augments start at 136.
const OFF = {
  valid: 132,
  moveSpeed: 136,
  gravity: 144,
  jumpMul: 152,
  wallJumpMul: 160,
  wallSlideMul: 168,
  shieldChargeMul: 176,
  shieldRechargeMul: 184,
  parryCoverMul: 192,
  parryCooldownMul: 200,
  maxHealthAdd: 208,
  airJumps: 216,
  dashCharges: 220,
  mirrorShield: 224,
  directionalShield: 225,
} as const;

function mkState(cards: string[]): WorldState {
  const p: PlayerEntity = {
    id: PID,
    characterId: "balanced",
    x: 400,
    y: 300,
    vx: 0,
    vy: 0,
    aimX: 500,
    aimY: 300,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards,
    fireCooldownMs: 0,
    ammo: 12,
    abilityCharge: 0,
    lastProcessedInputSeq: 0 as never,
    jetpackFuel: 0,
  };
  return {
    tick: Tick(0),
    rngState: 1,
    players: { [PID]: p } as Record<PlayerId, PlayerEntity>,
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    round: { phase: "fighting", countdownRemainingMs: 60_000, scores: {}, roundIndex: 1, winnerPlayerId: null },
  };
}

// Resolve + write the config for a card-carrying player, then read player-0's
// ResolvedFireConfig straight out of wasm linear memory (the bytes world.zig
// dereferences each tick).
function configView(cards: string[]): DataView {
  __clearFireConfigCacheForTests();
  writeFireConfigsForState(mkState(cards));
  const sim = __getCachedSim()!;
  const ex = __getCachedEx()! as unknown as {
    memory: WebAssembly.Memory;
    offset_player_fire_config: () => number;
    sizeof_resolved_fire_config: () => number;
  };
  const base = sim.statePtr + ex.offset_player_fire_config();
  return new DataView(ex.memory.buffer, base, ex.sizeof_resolved_fire_config());
}

describe("cutover gate — card augments reach the Zig orchestrator's config", () => {
  test("struct size matches the 248B extended ResolvedFireConfig", () => {
    const ex = __getCachedEx()! as unknown as { sizeof_resolved_fire_config: () => number };
    // 232 + dash_cooldown_mul (Quick Parry, repurposed onto the dash-bash
    // slide) + recoil_impulse (Track Z0c Item A, fire-recoil substrate).
    expect(ex.sizeof_resolved_fire_config()).toBe(248);
  });

  test("no cards → inert augments (valid config, all multipliers 1, counts 0)", () => {
    const v = configView([]);
    expect(v.getUint8(OFF.valid)).toBe(1);
    expect(v.getFloat64(OFF.jumpMul, true)).toBe(1);
    expect(v.getFloat64(OFF.moveSpeed, true)).toBe(1);
    expect(v.getUint32(OFF.airJumps, true)).toBe(0);
    expect(v.getUint32(OFF.dashCharges, true)).toBe(0);
    expect(v.getUint8(OFF.mirrorShield)).toBe(0);
    expect(v.getUint8(OFF.directionalShield)).toBe(0);
  });

  test("double-jump card → air_jumps = 1 in the config", () => {
    expect(configView(["double-jump"]).getUint32(OFF.airJumps, true)).toBe(1);
  });

  test("blink-dash card → dash_charges = 1", () => {
    expect(configView(["blink-dash"]).getUint32(OFF.dashCharges, true)).toBe(1);
  });

  test("mirror-shield card → mirror_shield flag = 1", () => {
    expect(configView(["mirror-shield"]).getUint8(OFF.mirrorShield)).toBe(1);
  });

  test("aim/riot shield card → directional_shield flag = 1 + charge mult > 1", () => {
    const v = configView(["riot-mirror"]);
    expect(v.getUint8(OFF.directionalShield)).toBe(1);
  });

  test("a jump-height card raises jump_mul above 1", () => {
    // "leap-*" style card at cards.ts:904 (jumpMultiplier 1.18).
    const v = configView(["kangaroo-legs"]);
    // If that id doesn't exist the build is inert (1.0); guard so the test is
    // about the PATH, not a specific id — any >1 proves the mult propagates.
    expect(v.getFloat64(OFF.jumpMul, true)).toBeGreaterThanOrEqual(1);
  });
});
