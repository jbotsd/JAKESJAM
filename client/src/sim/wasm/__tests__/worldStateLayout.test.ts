// G1c gate — calls the WorldState sizeof_* / world_state_max_*
// exports and confirms they return the layout this commit pinned.
//
// If a future refactor accidentally bumps a struct's size or
// changes a max constant, this fails first — before downstream
// parity / bridge tests even run.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadSimFromBytes } from "../loader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");

const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const sim = await loadSimFromBytes(ab);

type SizeofExports = {
  sizeof_world_state: () => number;
  sizeof_world_state_header: () => number;
  sizeof_player_entity: () => number;
  sizeof_projectile_entity: () => number;
  sizeof_satellite_entity: () => number;
  sizeof_destructible_entity: () => number;
  sizeof_fire_entity: () => number;
  sizeof_pickup_entity: () => number;
  world_state_max_players: () => number;
  world_state_max_projectiles: () => number;
  world_state_max_satellites: () => number;
  world_state_max_destructibles: () => number;
  world_state_max_fire: () => number;
  world_state_max_pickups: () => number;
};

const ex = sim.exports as unknown as SizeofExports;

describe("WorldState extern struct layout (Phase G1c)", () => {
  test("entity sizes match the wire contract", () => {
    expect(ex.sizeof_world_state_header()).toBe(48);
    expect(ex.sizeof_player_entity()).toBe(288);
    expect(ex.sizeof_projectile_entity()).toBe(216);
    expect(ex.sizeof_satellite_entity()).toBe(96);
    expect(ex.sizeof_destructible_entity()).toBe(64);
    expect(ex.sizeof_fire_entity()).toBe(88);
    expect(ex.sizeof_pickup_entity()).toBe(64);
  });

  test("max-entity counts match the wire contract", () => {
    expect(ex.world_state_max_players()).toBe(16);
    expect(ex.world_state_max_projectiles()).toBe(256);
    expect(ex.world_state_max_satellites()).toBe(32);
    expect(ex.world_state_max_destructibles()).toBe(64);
    expect(ex.world_state_max_fire()).toBe(32);
    expect(ex.world_state_max_pickups()).toBe(32);
  });

  test("total WorldState size derives correctly from entity sizes", () => {
    // Each entity-array preamble is 8 bytes (count u32 + pad).
    // PlayerMovementMemory has no preamble — sized by MAX_PLAYERS,
    // indexed parallel to players[].
    const sizeofMovement = (
      ex as unknown as { sizeof_player_movement_memory: () => number }
    ).sizeof_player_movement_memory();
    const expected =
      ex.sizeof_world_state_header() +
      (ex.world_state_max_players() * ex.sizeof_player_entity() + 8) +
      (ex.world_state_max_projectiles() * ex.sizeof_projectile_entity() + 8) +
      (ex.world_state_max_satellites() * ex.sizeof_satellite_entity() + 8) +
      (ex.world_state_max_destructibles() * ex.sizeof_destructible_entity() + 8) +
      (ex.world_state_max_fire() * ex.sizeof_fire_entity() + 8) +
      (ex.world_state_max_pickups() * ex.sizeof_pickup_entity() + 8) +
      ex.world_state_max_players() * sizeofMovement;
    expect(ex.sizeof_world_state()).toBe(expected);
  });
});
