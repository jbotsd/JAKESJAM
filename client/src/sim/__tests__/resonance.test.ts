// Tests for Resonance (docs/classes-goal.md "Rotation system",
// class-overhaul-workboard.md chunk 0.1 — "chain unlike abilities for a
// bonus"). Every successful ability activation (six-axes Layer 2 kinds and
// the Geometrician catalog v1 alike — the mechanism reads `active.kind`
// generically and never branches on classId) opens/refreshes a ~2s
// resonance window naming itself. A DIFFERENT kind cast inside that window
// consumes it for the v1 bonus: a fractional cooldown refund
// (RESONANCE_CD_REFUND_FRACTION) on the CONSUMING ability's own freshly-
// computed cooldown. The SAME kind cast again never resonates (see
// resonanceUntilTick's field comment in types.ts).
//
// Fixtures/style mirror abilitySlots.test.ts (the six-axes Layer 2 pilot
// test file) — same flatMap, same mkPlayer/mkState/inputsWith/frame
// helpers, same stepWithRuntime drive pattern.

import { describe, expect, test } from "bun:test";
import { createRuntime, stepWithRuntime } from "../World.js";
import { RESONANCE_WINDOW_MS, RESONANCE_CD_REFUND_FRACTION } from "../constants.js";
import {
  InputSeq,
  PlayerId,
  Tick,
  type InputFrame,
  type MapDefinition,
  type PlayerEntity,
  type WorldState,
} from "../types.js";

const A = PlayerId("a");

const DT_MS = 1000 / 60;
const SLOT1_BIT = 1 << 10;
const SLOT2_BIT = 1 << 11;

const flatMap: MapDefinition = {
  id: "test",
  name: "test",
  size: { x: 1280, y: 720 },
  spawns: [
    { x: 200, y: 400 },
    { x: 600, y: 400 },
  ],
  platforms: [
    {
      id: "floor",
      kind: "floor",
      position: { x: 0, y: 500 },
      size: { x: 1280, y: 60 },
    },
  ],
};

function mkPlayer(id: PlayerId, x: number, y: number, overrides: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id,
    characterId: "balanced",
    x,
    y,
    vx: 0,
    vy: 0,
    aimX: x + 100,
    aimY: y,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 0,
    ammo: 0,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    ...overrides,
  };
}

function mkState(players: PlayerEntity[]): WorldState {
  const playerMap: Record<PlayerId, PlayerEntity> = {};
  for (const p of players) playerMap[p.id] = p;
  return {
    tick: Tick(0),
    rngState: 1234567 >>> 0,
    players: playerMap,
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    round: {
      phase: "fighting",
      countdownRemainingMs: 90_000,
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      roundIndex: 0,
      winnerPlayerId: null,
    },
  };
}

function inputsWith(
  players: PlayerEntity[],
  overrides: Partial<Record<string, InputFrame>>,
): Record<PlayerId, InputFrame | null> {
  const out: Record<PlayerId, InputFrame | null> = {};
  for (const p of players) out[p.id] = overrides[p.id as string] ?? null;
  return out;
}

function frame(keys: number, seq: number, aimX = 0, aimY = 0): InputFrame {
  return { seq: InputSeq(seq), tick: Tick(0), keys, aimX, aimY, dtMs: DT_MS };
}

// recoil-step (Geometrician catalog v1): instant, unconditional activation
// (a self-hop — no target/line-of-sight requirement), cooldownMs 6000.
// measure (Geometrician catalog v1): instant, unconditional activation
// (banks an ammo tick), cooldownMs 9000.
// crimson-tithe (six-axes Layer 2, class-blind): instant window-open,
// unconditional activation, cooldownMs 14000.
// All three chosen because activation never depends on a target being in
// range/cone (facet-break, shadow-step's blocked-landing case, etc. can
// silently no-op, which would make the resonance timing brittle to test).

describe("Resonance (class-overhaul-workboard.md chunk 0.1)", () => {
  test("opens a resonance window on cast, naming itself as the source", () => {
    const caster = mkPlayer(A, 400, 400, { cards: ["recoil-step"] });
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);

    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );

    const p = res.state.players[A]!;
    expect(p.resonanceUntilTick).toBeDefined();
    expect((p.resonanceUntilTick as number) > res.state.tick).toBe(true);
    expect(p.resonanceSourceKind).toBe("recoil-step");
    // First-ever cast: nothing to consume, so no bonus event.
    expect(res.events.some((e) => e.t === "resonance-triggered")).toBe(false);

    // Window duration matches RESONANCE_WINDOW_MS (within one tick's grid).
    const windowTicks = Math.ceil(RESONANCE_WINDOW_MS / DT_MS);
    expect(p.resonanceUntilTick).toBe((res.state.tick + windowTicks) as Tick);
  });

  test("a DIFFERENT ability cast inside the window consumes it: cooldown refund + resonance-triggered event", () => {
    const caster = mkPlayer(A, 400, 400, { cards: ["recoil-step", "measure"] });
    let state = mkState([caster]);
    const runtime = createRuntime(flatMap);

    // Tick 1: open the window with recoil-step (slot 1).
    let res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    state = res.state;
    expect(state.players[A]!.resonanceSourceKind).toBe("recoil-step");

    // Tick 2 (well inside the 2s window): press measure (slot 2) — a
    // DIFFERENT kind, so it should resonate.
    res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT2_BIT, 2) }),
      DT_MS,
    );
    state = res.state;

    const bonusEvent = res.events.find((e) => e.t === "resonance-triggered");
    expect(bonusEvent).toBeDefined();
    if (bonusEvent?.t !== "resonance-triggered") throw new Error("unreachable");
    expect(bonusEvent.playerId).toBe(A);
    expect(bonusEvent.sourceKind).toBe("recoil-step");
    expect(bonusEvent.kind).toBe("measure");

    // Cooldown refund: measure's base cooldown is 9000ms → 540 ticks at
    // 60Hz. Resonated cooldown = round(540 * (1 - 0.3)) = 378 ticks.
    const baseCdTicks = Math.ceil(9000 / DT_MS);
    const expectedRefundedTicks = Math.round(baseCdTicks * (1 - RESONANCE_CD_REFUND_FRACTION));
    expect(expectedRefundedTicks).toBeLessThan(baseCdTicks);
    const p = state.players[A]!;
    expect(p.slot2CooldownUntilTick).toBe((state.tick + expectedRefundedTicks) as Tick);

    // The window is now re-sourced from the consuming ability (measure).
    expect(p.resonanceSourceKind).toBe("measure");
  });

  test("window expires if unused: a different ability cast after >2s gets no bonus", () => {
    const caster = mkPlayer(A, 400, 400, { cards: ["recoil-step", "measure"] });
    let state = mkState([caster]);
    const runtime = createRuntime(flatMap);

    let res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    state = res.state;

    // Let the window (2000ms ≈ 120 ticks) lapse with no input.
    for (let t = 0; t < 150; t++) {
      res = stepWithRuntime(state, runtime, inputsWith([caster], {}), DT_MS);
      state = res.state;
    }
    expect((state.players[A]!.resonanceUntilTick as number) <= state.tick).toBe(true);

    // Now press measure (slot 2) — window is closed, so no resonance.
    res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT2_BIT, 200) }),
      DT_MS,
    );
    state = res.state;

    expect(res.events.some((e) => e.t === "resonance-triggered")).toBe(false);
    const baseCdTicks = Math.ceil(9000 / DT_MS);
    expect(state.players[A]!.slot2CooldownUntilTick).toBe((state.tick + baseCdTicks) as Tick);
  });

  test("same ability cast twice does NOT trigger resonance (chains UNLIKE abilities only)", () => {
    // Isolate the same-kind exclusion from cooldown gating: real catalog
    // cooldowns (>=6s) always outlast the 2s window, so two REAL presses of
    // one button can never land inside each other's window — that's a
    // correct emergent property, not something this test can drive through
    // ordinary presses. Construct the mid-chain state directly instead:
    // recoil-step just opened a window, and (synthetically) its own
    // cooldown is already clear.
    const caster = mkPlayer(A, 400, 400, {
      cards: ["recoil-step", "measure"],
      resonanceUntilTick: Tick(500),
      resonanceSourceKind: "recoil-step",
    });
    const state = mkState([caster]);
    state.tick = Tick(100);
    const runtime = createRuntime(flatMap);

    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );

    expect(res.events.some((e) => e.t === "ability-activated")).toBe(true);
    expect(res.events.some((e) => e.t === "resonance-triggered")).toBe(false);

    const baseCdTicks = Math.ceil(6000 / DT_MS);
    const p = res.state.players[A]!;
    // Full (unrefunded) cooldown — no bonus for chaining into yourself.
    expect(p.slot1CooldownUntilTick).toBe((res.state.tick + baseCdTicks) as Tick);
    // The window is refreshed but still sourced from the same kind.
    expect(p.resonanceSourceKind).toBe("recoil-step");
    expect((p.resonanceUntilTick as number) > res.state.tick).toBe(true);
  });

  test("resonance is class-agnostic: chains a six-axes kind into a Geometrician-catalog kind", () => {
    // crimson-tithe (six-axes Layer 2, class-blind) → recoil-step
    // (Geometrician catalog v1, wizard-only at offer time) — proves the
    // mechanism itself doesn't care which "family" an ability kind comes
    // from, only that build.actives holds two DIFFERENT kinds.
    const caster = mkPlayer(A, 400, 400, { cards: ["crimson-tithe", "recoil-step"] });
    let state = mkState([caster]);
    const runtime = createRuntime(flatMap);

    let res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    state = res.state;
    expect(state.players[A]!.resonanceSourceKind).toBe("crimson-tithe");

    res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT2_BIT, 2) }),
      DT_MS,
    );
    state = res.state;

    const bonusEvent = res.events.find((e) => e.t === "resonance-triggered");
    expect(bonusEvent).toBeDefined();
    if (bonusEvent?.t !== "resonance-triggered") throw new Error("unreachable");
    expect(bonusEvent.sourceKind).toBe("crimson-tithe");
    expect(bonusEvent.kind).toBe("recoil-step");
  });

  test("additive-only: a build with zero abilities equipped never touches resonance state", () => {
    const caster = mkPlayer(A, 400, 400, { cards: [] });
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);

    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT | SLOT2_BIT, 1) }),
      DT_MS,
    );

    const p = res.state.players[A]!;
    expect(p.resonanceUntilTick).toBeUndefined();
    expect(p.resonanceSourceKind).toBeUndefined();
    expect(res.events.some((e) => e.t === "ability-activated" || e.t === "resonance-triggered")).toBe(false);
  });
});
