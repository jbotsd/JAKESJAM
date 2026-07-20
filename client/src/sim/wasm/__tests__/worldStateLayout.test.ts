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
    // 48 → 56 (2026-07-20, Phase 2, docs/zig-step-world-parity-goal.md —
    // draft/offer-roll system): +4 content bytes for
    // WorldStateHeader.round_winner_idx (i32), rounded to 56 by the
    // trailing f64's own 8-byte alignment need. See world_state.zig's
    // WorldStateHeader comptime assert.
    expect(ex.sizeof_world_state_header()).toBe(56);
    // 288 → 296 (2026-07-18, deliberate bump): +8 bytes for
    // PlayerEntity.energy (ninja class resource) — see world_state.zig's
    // comptime assert and worldStateBridge.ts's PLAYER_ENTITY_SIZE.
    // 296 → 328 (2026-07-18, class-overhaul-workboard.md chunk 1.1):
    // +team_id_len/team_id_bytes (duos-queue team identity), rounded up to
    // the next 8-byte multiple by the struct's own trailing alignment pad.
    // 328 → 336 (2026-07-18, class-overhaul-workboard.md chunk 2.3):
    // +PlayerEntity.kindling (paladin class resource, f64) — reclaims the
    // prior trailing pad as the new field's alignment gap. See
    // world_state.zig's comptime assert and worldStateBridge.ts's
    // PLAYER_ENTITY_SIZE.
    // 336 → 360 (2026-07-18, class-overhaul-workboard.md chunk 3.1):
    // +PlayerEntity.regen_until_tick/haste_until_tick (u32 x2) +
    // regen_hps/haste_multiplier (f64 x2) — no padding needed anywhere.
    // See world_state.zig's comptime assert and worldStateBridge.ts's
    // PLAYER_ENTITY_SIZE.
    // 360 → 368 (2026-07-18, class-overhaul-workboard.md chunk 3.2):
    // +PlayerEntity.devotion (f64) — no padding needed.
    // 368 → 384 (2026-07-18, class-overhaul-workboard.md chunk 3.3):
    // +PlayerEntity.syz_ward_absorb_until_tick (u32) +
    // syz_ward_absorb_remaining (f64) — 4 bytes of implicit alignment pad
    // between the two. See world_state.zig's comptime assert and
    // worldStateBridge.ts's PLAYER_ENTITY_SIZE.
    // 384 → 392 → 504 → 512 (2026-07-20, gap-closure + Phase 1 ability-cast
    // dispatch + AOE-queue window passes): channel_hold_ms, the ability-
    // slot cooldown/status window fields, and the AOE-queue window fields.
    // See world_state.zig's comptime assert and worldStateBridge.ts's
    // PLAYER_ENTITY_SIZE for the full accounting.
    expect(ex.sizeof_player_entity()).toBe(512);
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
    const sizeofFireConfig = (
      ex as unknown as { sizeof_resolved_fire_config: () => number }
    ).sizeof_resolved_fire_config();
    const maxStatics = (
      ex as unknown as { world_state_max_statics: () => number }
    ).world_state_max_statics();
    const maxEvents = (
      ex as unknown as { world_state_max_events_per_tick: () => number }
    ).world_state_max_events_per_tick();
    const sizeofEvent = (
      ex as unknown as { sizeof_sim_event: () => number }
    ).sizeof_sim_event();
    // No wasm sizeof_* exports exist for these (2026-07-20 additions) —
    // literal byte counts pinned from world_state.zig's own comptime
    // asserts/doc comments (PaperDoubleEntity=96×MAX_PAPER_DOUBLES(16),
    // MeleeSwingMemory=32, EquippedActives=3 (MAX_ABILITY_SLOTS),
    // PlayerCardIds=8 (MAX_PLAYER_CARDS), PlayerDraftState=4
    // (DRAFT_OFFER_COUNT+1), PendingInstantAoe=80×MAX_PENDING_INSTANT_AOE(32)).
    const PAPER_DOUBLE_SIZE = 96;
    const MAX_PAPER_DOUBLES = 16;
    const MELEE_SWING_MEMORY_SIZE = 32;
    const EQUIPPED_ACTIVES_SIZE = 3;
    const PLAYER_CARD_IDS_SIZE = 8;
    const PLAYER_DRAFT_STATE_SIZE = 4;
    const PENDING_INSTANT_AOE_SIZE = 80;
    const MAX_PENDING_INSTANT_AOE = 32;
    const expected =
      ex.sizeof_world_state_header() +
      (ex.world_state_max_players() * ex.sizeof_player_entity() + 8) +
      (ex.world_state_max_projectiles() * ex.sizeof_projectile_entity() + 8) +
      (ex.world_state_max_satellites() * ex.sizeof_satellite_entity() + 8) +
      (ex.world_state_max_destructibles() * ex.sizeof_destructible_entity() + 8) +
      (ex.world_state_max_fire() * ex.sizeof_fire_entity() + 8) +
      (ex.world_state_max_pickups() * ex.sizeof_pickup_entity() + 8) +
      // Paper Double decoys: 8 preamble + N×96.
      (8 + MAX_PAPER_DOUBLES * PAPER_DOUBLE_SIZE) +
      ex.world_state_max_players() * sizeofMovement +
      // Melee swing FSM memory (no preamble).
      ex.world_state_max_players() * MELEE_SWING_MEMORY_SIZE +
      // I-final player_fire_config parallel array (no preamble).
      ex.world_state_max_players() * sizeofFireConfig +
      // Phase 2 — equipped actives / card hand / draft state (no preambles).
      ex.world_state_max_players() * EQUIPPED_ACTIVES_SIZE +
      ex.world_state_max_players() * PLAYER_CARD_IDS_SIZE +
      ex.world_state_max_players() * PLAYER_DRAFT_STATE_SIZE +
      // I15 static cache: 8 preamble + N×32 AABB + N×1 one_way + 4 tail.
      8 +
      maxStatics * 32 +
      maxStatics +
      4 +
      // Pending instant-AOE cast queue: 4 count + 4 explicit pad + 4
      // IMPLICIT Zig alignment pad (this field's own offset lands
      // non-8-aligned after the statics section, and PendingInstantAoe
      // has f64 fields → needs 8-byte alignment) + N×80. Verified
      // empirically against the live wasm sizeof_world_state() + a raw
      // memory event_count probe (2026-07-20) — this is the same "extra
      // 4 bytes" the events buffer below used to need before this
      // section existed between statics and events.
      12 +
      MAX_PENDING_INSTANT_AOE * PENDING_INSTANT_AOE_SIZE +
      // I18 events buffer: 4 count + 4 pad + M×SimEvent (40B, 8-aligned).
      // No further implicit alignment pad needed here anymore — the
      // pending-AOE section above now absorbs it.
      8 +
      maxEvents * sizeofEvent;
    expect(ex.sizeof_world_state()).toBe(expected);
  });
});
