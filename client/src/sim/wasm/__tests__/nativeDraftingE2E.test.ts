// Zig e2e cutover investigation, 2026-07-14 — native drafting, the FULL
// wire round-trip (not the isolated draft.zig algorithm proven by
// sim/test/smoke.zig's golden-vector tests). This drives the real TS
// pack -> step_world -> unpack cycle across MULTIPLE ticks via
// applyWasmWorldStepFull, threading the returned state forward exactly
// like a real caller would — proving:
//   1. round-over -> drafting entry rolls offers that are REAL, valid
//      card ids (decoded through the actual wire, not asserted in Zig
//      isolation).
//   2. those offers match what TS's OWN round.ts enterDrafting/
//      draftWeights.ts would produce for the identical seed + role +
//      pool — cross-language parity, not just "Zig ran without crashing".
//   3. the drafting window SURVIVES more than one pack/unpack cycle (this
//      is the exact bug class fixed in this file's own history today:
//      packPlayer originally hardcoded draft_offers/draft_picked_offer to
//      a "not drafting" sentinel on every pack, which would have silently
//      reset the window on tick 2 even though tick 1 rolled it correctly).
//   4. world_state_commit_draft_pick grants the card and the pick
//      survives being threaded through another step.
//   5. drafting -> countdown exit happens once every drafter has picked.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import {
  preloadWasmWorldSim,
  applyWasmWorldStepFull,
  commitDraftPick,
} from "../worldWasmBackend";
import { wasmHost } from "../wasmHost";
import { writeFireConfigsForState, __clearFireConfigCacheForTests } from "../writeFireConfigs";
import { classifyDraftRole, weightForCard, pickWeighted } from "../../draftWeights";
import { crystalRoundsCards } from "../../data/cards";
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

function makePlayer(id: string): PlayerEntity {
  return {
    id: PlayerId(id),
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
    cards: [],
    fireCooldownMs: 9999,
    ammo: 12,
    abilityCharge: 0,
    lastProcessedInputSeq: 0 as never,
    jetpackFuel: 0,
  };
}

// Independent TS-side computation of what enterDrafting would roll for a
// single player, mirroring round.ts's exact loop (bounded retry, weighted
// pick, seen-set dedup) so this test doesn't depend on importing a
// private function — same technique sim/test/smoke.zig's golden vectors
// used, just run inline here for a live cross-check against THIS test's
// own seed/pool instead of a fixed fixture.
const DRAFT_OFFER_COUNT = 3;
const ALL_CARDS = crystalRoundsCards.filter((c) => c.modifier);
function rollOffersTs(pool: typeof ALL_CARDS, role: ReturnType<typeof classifyDraftRole>, seed: number) {
  let cursor = seed;
  const offered: string[] = [];
  if (pool.length === 0) return { offered, cursor };
  const seen = new Set<string>();
  const target = Math.min(DRAFT_OFFER_COUNT, pool.length);
  let attempts = 0;
  while (offered.length < target && attempts < target * 8) {
    const remaining = pool.filter((c) => !seen.has(c.id));
    if (remaining.length === 0) break;
    const [next, picked] = pickWeighted(cursor, remaining, (c) => weightForCard(c, role));
    cursor = next;
    if (!seen.has(picked.id)) {
      seen.add(picked.id);
      offered.push(picked.id);
    }
    attempts += 1;
  }
  return { offered, cursor };
}

function buildRoundOverState(seed: number, winnerId: string | null): WorldState {
  const p0 = makePlayer("p0");
  const p1 = makePlayer("p1");
  return {
    tick: Tick(100),
    rngState: seed,
    players: { [PlayerId("p0")]: p0, [PlayerId("p1")]: p1 } as Record<PlayerId, PlayerEntity>,
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    round: {
      phase: "round-over",
      countdownRemainingMs: 1, // expires this tick
      scores: { [PlayerId("p0")]: 1, [PlayerId("p1")]: 0 } as Record<string, number>,
      roundIndex: 3,
      winnerPlayerId: winnerId === null ? null : PlayerId(winnerId),
    },
  };
}

describe("native drafting — full TS<->Zig wire round trip (2026-07-14)", () => {
  test("round-over entry rolls offers matching TS's own enterDrafting for the identical seed", async () => {
    const SEED = 24601;
    const state = buildRoundOverState(SEED, "p0");
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(state);
    const { state: next } = await applyWasmWorldStepFull(state, 16.667);

    expect(next.round.phase).toBe("drafting");
    expect(next.round.winnerPlayerId).toBe(PlayerId("p0"));
    const p0 = next.players[PlayerId("p0")]!;
    const p1 = next.players[PlayerId("p1")]!;
    expect(p0.draftOffers).toBeDefined();
    expect(p1.draftOffers).toBeDefined();
    expect(p0.draftOffers).toHaveLength(3);
    expect(p1.draftOffers).toHaveLength(3);
    // Every offered id must be a REAL card (decoded through the wire, not
    // asserted in isolation) and no duplicates within a single offer.
    for (const offers of [p0.draftOffers!, p1.draftOffers!]) {
      expect(new Set(offers).size).toBe(offers.length);
      for (const id of offers) {
        expect(ALL_CARDS.some((c) => c.id === id)).toBe(true);
      }
    }

    // Cross-language parity: independently compute what TS's own
    // enterDrafting algorithm produces for the SAME seed + roles + pool,
    // and require an EXACT match — this is the proof that the wire
    // round-trip (not just draft.zig in isolation) reproduces TS.
    const winnerRole = classifyDraftRole("p0", "p0"); // "winner"
    const loserRole = classifyDraftRole("p1", "p0"); // "catch_up"
    // enterDrafting iterates players sorted by id ("p0" then "p1"),
    // threading ONE rng cursor across both — reproduce that exactly.
    const p0Expected = rollOffersTs(ALL_CARDS, winnerRole, SEED);
    const p1Expected = rollOffersTs(ALL_CARDS, loserRole, p0Expected.cursor);

    expect(p0.draftOffers).toEqual(p0Expected.offered);
    expect(p1.draftOffers).toEqual(p1Expected.offered);
    expect(next.rngState).toBe(p1Expected.cursor);
  });

  test("drafting window survives a SECOND pack/unpack cycle unchanged (regression: packPlayer used to hardcode the sentinel)", async () => {
    const state = buildRoundOverState(777, "p0");
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(state);
    const { state: afterEntry } = await applyWasmWorldStepFull(state, 16.667);
    expect(afterEntry.round.phase).toBe("drafting");
    const offersBefore = afterEntry.players[PlayerId("p0")]!.draftOffers;

    // Thread the state forward exactly like a real caller — a second tick
    // with nobody picking anything yet.
    writeFireConfigsForState(afterEntry);
    const { state: secondTick } = await applyWasmWorldStepFull(afterEntry, 16.667);

    expect(secondTick.round.phase).toBe("drafting"); // did NOT reset
    expect(secondTick.players[PlayerId("p0")]!.draftOffers).toEqual(offersBefore);
    expect(secondTick.players[PlayerId("p0")]!.draftPickedOffer).toBeUndefined();
  });

  test("commitDraftPick grants the card and the pick survives threading through another step", async () => {
    const state = buildRoundOverState(555, "p0");
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(state);
    const { state: drafting } = await applyWasmWorldStepFull(state, 16.667);
    expect(drafting.round.phase).toBe("drafting");

    const p0Offer0 = drafting.players[PlayerId("p0")]!.draftOffers![0]!;
    const p1Offer1 = drafting.players[PlayerId("p1")]!.draftOffers![1]!;

    // player index order matches packPlayer's sort-by-id convention: p0=0, p1=1.
    const p0Granted = commitDraftPick(0, 0);
    const p1Granted = commitDraftPick(1, 1);
    expect(p0Granted).toBe(p0Offer0);
    expect(p1Granted).toBe(p1Offer1);
    // Re-committing is rejected — already picked.
    expect(commitDraftPick(0, 1)).toBeNull();

    // The commit only mutated wasm memory — the next applyWasmWorldStepFull
    // call re-packs from whatever TS object it's given, so (per
    // commitDraftPick's own documented contract) the caller must patch its
    // own copy before threading it into the next step, or the repack wipes
    // the pick. This is the real calling convention, not a test-only hack.
    const p0 = drafting.players[PlayerId("p0")]!;
    const p1 = drafting.players[PlayerId("p1")]!;
    const patched: WorldState = {
      ...drafting,
      players: {
        ...drafting.players,
        [PlayerId("p0")]: { ...p0, draftPickedOffer: 0, cards: [...p0.cards, p0Granted!] },
        [PlayerId("p1")]: { ...p1, draftPickedOffer: 1, cards: [...p1.cards, p1Granted!] },
      } as WorldState["players"],
    };

    writeFireConfigsForState(patched);
    const { state: resolved } = await applyWasmWorldStepFull(patched, 16.667);

    expect(resolved.round.phase).toBe("countdown");
    expect(resolved.players[PlayerId("p0")]!.cards).toContain(p0Offer0);
    expect(resolved.players[PlayerId("p1")]!.cards).toContain(p1Offer1);
  });

  test("draw (no winner) gives every player standard-role weighting", async () => {
    const SEED = 90909;
    const state = buildRoundOverState(SEED, null);
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(state);
    const { state: next } = await applyWasmWorldStepFull(state, 16.667);

    expect(next.round.phase).toBe("drafting");
    expect(next.round.winnerPlayerId).toBeNull();
    const standardRole = classifyDraftRole("p0", null);
    expect(standardRole).toBe("standard");
    const p0Expected = rollOffersTs(ALL_CARDS, "standard", SEED);
    expect(next.players[PlayerId("p0")]!.draftOffers).toEqual(p0Expected.offered);
  });
});
