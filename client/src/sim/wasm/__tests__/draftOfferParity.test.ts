// Track Z2 item 1 (convergence-goal.md) — TS-vs-Zig draft parity.
//
// The server's wasm path used to run a TS "drafting overlay" because "the
// Zig round machine skips drafting" — stale since parity-goal Phase 2
// landed draft.zig, and doubly moot because the draft parallel arrays
// were wiped by every repack (see PLAYER_DRAFT_STATE_SIZE's bridge note).
// With the overlay retired, Zig owns offers/picks/auto-pick timing — so
// this suite proves the Zig draft IS the TS draft:
//
//   A. LAYOUT — the bridge's PLAYER_DRAFT_STATE_OFFSET/SIZE equal wasm's
//      own @offsetOf/@sizeOf exports.
//   B. OFFERS — for the same seed, same roster (mixed classes, hands
//      exercising the unique/maxStacks/rack-cap/class gates, a real round
//      winner for catch-up weighting), enterDrafting (TS) and
//      world_draft_roll_offers (Zig) produce IDENTICAL offer lists per
//      player and land on the IDENTICAL rng cursor.
//   C. TIMING — round_draft_window_ms() === DRAFT_WINDOW_MS, and a
//      full-sync wasm world holds the drafting phase for EXACTLY the same
//      number of ticks as TS's stepRound driven from the same entry
//      (nobody picking → expiry auto-pick on both sides).

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import {
  preloadWasmWorldSim,
  applyWasmWorldStepFullSync,
  setWorldStatics,
  setWorldArenaBounds,
  setWorldLaunchPads,
  setWorldSlopes,
  setWorldSpawnPoints,
  setWorldTargetScore,
  __getCachedSim,
  __getCachedEx,
} from "../worldWasmBackend";
import { wasmHost } from "../wasmHost";
import { applyWasmPlayerFlag } from "../runtime";
import { KILL_PLANE_MARGIN_PX } from "../../player";
import { platformToAABB } from "../../collision";
import { resolveModeConfig } from "../../data/modeConfig";
import { createRuntime } from "../../World";
import {
  packWorldState,
  unpackWorldState,
  WORLD_STATE_TOTAL_SIZE,
  PLAYER_DRAFT_STATE_OFFSET,
  PLAYER_DRAFT_STATE_SIZE,
} from "../worldStateBridge";
import {
  resolveFireConfigsViaZig,
  cardIdForIndex,
  type FireConfigResolverExports,
} from "../fireConfigShared";
import { enterDrafting, stepRound, DRAFT_WINDOW_MS } from "../../round";
import { STEP_MS } from "../../index";
import {
  InputSeq,
  PlayerId,
  Tick,
  type CharacterArchetype,
  type MapDefinition,
  type PlayerEntity,
  type RoundState,
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
await applyWasmPlayerFlag();

const DT_MS = 1000 / 60;
const MAP: MapDefinition = {
  id: "draft-parity-arena",
  name: "Draft Parity Arena",
  size: { x: 1600, y: 900 },
  spawns: [
    { x: 300, y: 400 },
    { x: 700, y: 400 },
    { x: 1100, y: 400 },
    { x: 1500, y: 400 },
  ],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 800, y: 730 }, size: { x: 1600, y: 60 } },
  ],
};

function makePlayer(
  id: string,
  x: number,
  characterId: CharacterArchetype,
  cards: string[],
): PlayerEntity {
  return {
    id: PlayerId(id),
    characterId,
    x,
    y: 400,
    vx: 0,
    vy: 0,
    aimX: x + 100,
    aimY: 400,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards,
    fireCooldownMs: 0,
    ammo: 12,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    jetpackFuel: 0,
  };
}

/** Mixed-class roster whose hands exercise the offer-roll gates: p0 holds
 *  an ability card (rack count 1 — no pity floor), p2 holds a unique card
 *  (excluded from its own pool), p1/p3 empty hands (pity floor eligible). */
function makeRoster(): Record<PlayerId, PlayerEntity> {
  return {
    [PlayerId("p0")]: makePlayer("p0", 300, "balanced", ["sunlance"]),
    [PlayerId("p1")]: makePlayer("p1", 700, "sprinter", []),
    [PlayerId("p2")]: makePlayer("p2", 1100, "heavy", ["crystal-volley"]),
    [PlayerId("p3")]: makePlayer("p3", 1500, "shielded", []),
  } as Record<PlayerId, PlayerEntity>;
}

function makeState(round: Partial<RoundState>, rngState: number): WorldState {
  return {
    tick: Tick(100),
    rngState,
    players: makeRoster(),
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    round: {
      phase: "fighting",
      countdownRemainingMs: 90_000,
      scores: {},
      roundIndex: 2,
      winnerPlayerId: null,
      ...round,
    },
  };
}

describe("draft parity (Track Z2 item 1)", () => {
  test("A. layout — TS offset/stride match wasm's @offsetOf/@sizeOf", () => {
    const ex = __getCachedEx() as unknown as {
      offset_player_draft_state?: () => number;
      sizeof_player_draft_state?: () => number;
    };
    expect(typeof ex.offset_player_draft_state).toBe("function");
    expect(ex.offset_player_draft_state!()).toBe(PLAYER_DRAFT_STATE_OFFSET);
    expect(ex.sizeof_player_draft_state!()).toBe(PLAYER_DRAFT_STATE_SIZE);
  });

  test("B. offers — same seed, same roster: identical offers per player + identical rng cursor", () => {
    const SEED = 0xc0ffee;
    const state = makeState(
      // Real round winner → the winner/catch-up weighting paths are LIVE
      // on both sides (round_winner_idx rides the Track Z2 header bridge).
      { phase: "round-over", winnerPlayerId: PlayerId("p1"), scores: { [PlayerId("p1")]: 1 } },
      SEED,
    );

    // TS side.
    const tsDraft = enterDrafting(state.round, state.players, state.tick, SEED);

    // Zig side: pack the hand-seeded state into the backend instance,
    // deliver loadouts (hands + racks — the same candidate-gate inputs TS
    // reads off player.cards), roll, read back.
    const sim = __getCachedSim()!;
    const ex = __getCachedEx()! as unknown as FireConfigResolverExports & {
      world_draft_roll_offers: (statePtr: number) => void;
    };
    const heap = new Uint8Array(ex.memory.buffer);
    heap.set(packWorldState(state), sim.statePtr);
    resolveFireConfigsViaZig(ex, sim.statePtr, state);
    ex.world_draft_roll_offers(sim.statePtr);
    const back = unpackWorldState(
      new Uint8Array(ex.memory.buffer, sim.statePtr, WORLD_STATE_TOTAL_SIZE).slice(),
    );

    for (const pid of Object.keys(state.players).sort()) {
      const zigOffers = (back.draftMemory[PlayerId(pid)]?.offers ?? [])
        .filter((o) => o > 0)
        .map((o) => cardIdForIndex(o - 1));
      expect({ pid, offers: zigOffers }).toEqual({
        pid,
        offers: tsDraft.state.draftingOffers?.[PlayerId(pid)] ?? [],
      });
      // Every player got a full roll (the pool is far larger than
      // DRAFT_OFFER_COUNT for this roster) — guards against a
      // trivially-empty pass.
      expect(zigOffers.length).toBe(3);
    }
    // The rng cursor advanced identically — the two rolls consumed the
    // exact same draw sequence.
    expect(back.rngState >>> 0).toBe(tsDraft.rngState >>> 0);
  });

  test("C. timing — window constant matches and the drafting phase holds for the same tick count on both sides", () => {
    const ex = __getCachedEx() as unknown as {
      round_draft_window_ms?: () => number;
    };
    expect(typeof ex.round_draft_window_ms).toBe("function");
    expect(ex.round_draft_window_ms!()).toBe(DRAFT_WINDOW_MS);

    // TS side: enter drafting, then step the round machine with nobody
    // picking until it leaves — counts the expiry path's tick span.
    const SEED = 424242;
    const players = makeRoster();
    const entryRound: RoundState = {
      phase: "round-over",
      countdownRemainingMs: 0,
      scores: { [PlayerId("p1")]: 1 },
      roundIndex: 2,
      winnerPlayerId: PlayerId("p1"),
    };
    const tsEntry = enterDrafting(entryRound, players, Tick(100), SEED);
    let tsRound = tsEntry.state;
    let tsTicks = 0;
    for (let t = 101; tsRound.phase === "drafting"; t++) {
      const r = stepRound({
        state: tsRound,
        players,
        dtMs: STEP_MS,
        targetScore: resolveModeConfig(undefined).targetScore,
        tick: Tick(t),
        rngState: SEED,
      });
      tsRound = r.state;
      tsTicks++;
      if (tsTicks > 2000) throw new Error("TS drafting never resolved");
    }

    // Zig side: full-sync world entering drafting via its own round
    // machine (round-over with an expiring hold), then held with no picks.
    const runtime = createRuntime(MAP);
    setWorldStatics(
      MAP.platforms.map(platformToAABB),
      MAP.platforms.map((p) => (p.kind === "platform" ? 1 : 0)),
    );
    setWorldArenaBounds(
      runtime.ceilingClampY,
      MAP.size.y > 0 ? MAP.size.y + KILL_PLANE_MARGIN_PX : 0,
    );
    setWorldLaunchPads([]);
    setWorldSlopes([]);
    setWorldSpawnPoints(MAP.spawns);
    setWorldTargetScore(resolveModeConfig(undefined).targetScore);
    let zigState = makeState(
      {
        phase: "round-over",
        countdownRemainingMs: 1,
        winnerPlayerId: PlayerId("p1"),
        scores: { [PlayerId("p1")]: 1 },
      },
      SEED,
    );
    (globalThis as {
      __jakesjam_wasm_inputs__?: ReadonlyMap<
        string,
        { keys: number; prevKeys: number; aimX: number; aimY: number }
      >;
    }).__jakesjam_wasm_inputs__ = new Map(
      Object.keys(zigState.players).map((id) => [
        id,
        { keys: 0, prevKeys: 0, aimX: 800, aimY: 400 },
      ]),
    );

    // Enter drafting via the Zig phase machine.
    let guard = 0;
    let sawAutoPickEvents = 0;
    while (zigState.round.phase !== "drafting") {
      zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;
      if (++guard > 10) throw new Error("Zig never entered drafting");
    }
    // Offers survived INTO the held phase (the draftMemory bridge — the
    // pre-Z2 pack wiped them the very next tick).
    const p0Offers = zigState.draftMemory?.[PlayerId("p0")]?.offers ?? [];
    expect(p0Offers.filter((o) => o > 0).length).toBe(3);

    let zigTicks = 0;
    while (zigState.round.phase === "drafting") {
      const r = applyWasmWorldStepFullSync(zigState, DT_MS);
      zigState = r.state;
      zigTicks++;
      // kind 14 = draft_resolved; player_idx_b === 1 marks the expiry
      // auto-pick (surfaced through the surviving event stream).
      sawAutoPickEvents += r.events.filter(
        (e) => e.kind === 14 && e.playerIdxB === 1,
      ).length;
      if (zigTicks > 2000) throw new Error("Zig drafting never resolved");
    }

    expect(zigTicks).toBe(tsTicks);
    // Every roster seat auto-picked at expiry (nobody picked manually) —
    // the same guarantee TS's expiry branch gives its drafters.
    expect(sawAutoPickEvents).toBe(4);
    // And the phase machine landed where TS lands: countdown, next round.
    expect(zigState.round.phase).toBe("countdown");
    expect(zigState.round.roundIndex).toBe(3);
    expect(zigState.round.winnerPlayerId).toBeNull();
  });
});
