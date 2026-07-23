// Track Z0d (convergence-goal.md) — first-blood wager TS-vs-Zig parity.
// The multi-seed divergence meter's Z0c header named the missing Zig mirror
// of TS's first-blood speed boost (World.ts:2532 firstBloodMul, round.ts:37
// FIRST_BLOOD_SPEED_MULTIPLIER = 1.15) as its top evidenced hypothesis: a
// SUSTAINED per-round divergence engine — after the round's first
// attacker-attributed hit, the TS-side claimant walks 15% faster than its
// Zig twin for the rest of the round. This file proves the Z0d port closes
// that engine at the mechanism level, driving BOTH orchestrators in
// lockstep (same harness discipline as multiSeedDivergence.test.ts — real
// statics, arena bounds, spawn points, target score, true prevKeys, pinned
// module caches) through the wager's full lifecycle:
//   (a) CLAIM — one real pistol shot kills the victim; both sides must
//       agree on WHO holds first blood and on WHICH TICK it was claimed
//       (Zig awards mid-tick at the section-4 damage site, TS at its
//       end-of-tick commit — both visible in the same post-step state,
//       and tickOrderParity already proved the hit lands the same tick).
//   (b) BOOST — the claimant then holds Right for 180 ticks; with the
//       1.15x multiplier composed into BOTH speed products the twin
//       positions must track each other tightly (before this port the
//       TS twin outran Zig by ~15% of every step — hundreds of px here).
//   (c) CLEAR — the round is driven through round-over → drafting →
//       countdown → fighting; both sides must come out unclaimed.
// Zig-side unit coverage (claim guard, plus-one encoding, boost ratio,
// transition clears) lives in sim/test/smoke.zig; TS-side integration in
// client/src/sim/__tests__/firstBloodSuddenDeath.test.ts. This file owns
// ONLY the cross-boundary agreement.

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
} from "../worldWasmBackend";
import { wasmHost } from "../wasmHost";
import { applyWasmPlayerFlag } from "../runtime";
import { KILL_PLANE_MARGIN_PX } from "../../player";
import { platformToAABB } from "../../collision";
import { resolveModeConfig } from "../../data/modeConfig";
import {
  writeFireConfigsForState,
  __clearFireConfigCacheForTests,
} from "../writeFireConfigs";
import { createRuntime, stepWithRuntime } from "../../World";
import {
  InputSeq,
  PlayerId,
  Tick,
  type InputFrame,
  type MapDefinition,
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
await applyWasmPlayerFlag(); // TS movement runs the SAME wasm stepPlayer Zig uses

const DT_MS = 1000 / 60;
const A = "p0"; // attacker → first-blood claimant
const B = "p1"; // victim (12hp — one starter-pistol hit kills)

const MAP: MapDefinition = {
  id: "first-blood-parity-arena",
  name: "First Blood Parity Arena",
  size: { x: 1600, y: 900 },
  spawns: [
    { x: 300, y: 400 },
    { x: 550, y: 400 },
  ],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 800, y: 730 }, size: { x: 1600, y: 60 } },
  ],
};

const RightBit = 1 << 1;
const FireBit = 1 << 6;

function makePlayer(id: string, x: number, health: number): PlayerEntity {
  return {
    id: PlayerId(id),
    characterId: "balanced",
    x,
    y: 400,
    vx: 0,
    vy: 0,
    aimX: x + 100,
    aimY: 400,
    health,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 0,
    ammo: 12,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    jetpackFuel: 0,
  };
}

type Aim = { x: number; y: number };
type TickInput = { keys: number; aim: Aim };

describe("first-blood wager TS-vs-Zig parity (Track Z0d)", () => {
  test("claim tick + claimant agree; boosted movement tracks over 180 ticks; both sides clear across the round cycle", async () => {
    const playerIds = [A, B];

    // TS side.
    const runtime = createRuntime(MAP);
    let tsState: WorldState = {
      tick: Tick(0),
      rngState: 7,
      players: {
        [PlayerId(A)]: makePlayer(A, 300, 100),
        [PlayerId(B)]: makePlayer(B, 550, 12),
      } as Record<PlayerId, PlayerEntity>,
      projectiles: {},
      destructibles: {},
      firePatches: {},
      pickups: {},
      satellites: {},
      round: {
        phase: "fighting",
        countdownRemainingMs: 90_000,
        scores: {},
        roundIndex: 1,
        winnerPlayerId: null,
      },
    };

    // Zig side — identical initial state; pin ALL module-level wasm caches
    // (multiSeedDivergence's harness-fidelity lessons, kept verbatim).
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
    let zigState: WorldState = structuredClone(tsState);

    const prevKeys: Record<string, number> = { [A]: 0, [B]: 0 };

    /** Step BOTH orchestrators one tick with the same inputs. */
    const stepBoth = (inputs: Record<string, TickInput>) => {
      const tsInputs: Record<PlayerId, InputFrame | null> = {};
      for (const id of playerIds) {
        const s = inputs[id]!;
        tsInputs[PlayerId(id)] = {
          seq: InputSeq(Number(tsState.tick) + 1),
          tick: Tick(Number(tsState.tick) + 1),
          keys: s.keys,
          aimX: s.aim.x,
          aimY: s.aim.y,
          dtMs: DT_MS,
        };
      }
      tsState = stepWithRuntime(tsState, runtime, tsInputs, DT_MS).state;

      (globalThis as {
        __jakesjam_wasm_inputs__?: ReadonlyMap<
          string,
          { keys: number; prevKeys: number; aimX: number; aimY: number }
        >;
      }).__jakesjam_wasm_inputs__ = new Map(
        playerIds.map((id) => {
          const s = inputs[id]!;
          return [id, { keys: s.keys, prevKeys: prevKeys[id]!, aimX: s.aim.x, aimY: s.aim.y }];
        }),
      );
      __clearFireConfigCacheForTests();
      writeFireConfigsForState(zigState);
      zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;
      for (const id of playerIds) prevKeys[id] = inputs[id]!.keys;
    };

    const idle = (aimA: Aim): Record<string, TickInput> => ({
      [A]: { keys: 0, aim: aimA },
      [B]: { keys: 0, aim: { x: 100, y: 0 } },
    });

    // --- Settle: 60 input-less ticks so both players land on the floor.
    for (let t = 0; t < 60; t++) stepBoth(idle({ x: 550, y: 400 }));
    expect(tsState.round.firstBloodPlayerId).toBeUndefined();
    expect(zigState.round.firstBloodPlayerId).toBeUndefined();

    // --- (a) CLAIM. One-tick Fire press from A aimed at B, then park the
    // 12hp victim ON the live shard on BOTH sides (same geometry-proof
    // idiom as sim/test/smoke.zig's Facet Break + first-blood tests —
    // identical mutation of both states, so it is not a divergence
    // source). The hit both damages AND kills: first blood claims on the
    // hit (World.ts's resolveRangedHit check runs before the HP
    // subtraction), so the claimant is also the killer here.
    const aimAtB: Aim = { x: tsState.players[PlayerId(B)]!.x, y: tsState.players[PlayerId(B)]!.y };
    stepBoth({
      [A]: { keys: FireBit, aim: aimAtB },
      [B]: { keys: 0, aim: { x: 100, y: 0 } },
    });
    // The recoil kick crossing the boundary is bit-identical (Z0c Item A);
    // asserted here because (b)'s window inherits this velocity state.
    {
      const a0 = tsState.players[PlayerId(A)]!;
      const z0 = zigState.players[PlayerId(A)]!;
      expect(Math.abs(a0.vx - z0.vx)).toBeLessThan(1e-9);
      expect(Math.abs(a0.vy - z0.vy)).toBeLessThan(1e-9);
    }
    const tsProj = Object.values(tsState.projectiles)[0];
    const zigProj = Object.values(zigState.projectiles)[0];
    expect(tsProj).toBeDefined();
    expect(zigProj).toBeDefined();
    // Muzzle + first-tick flight agree (tickOrderParity's guarantee,
    // re-checked here because the parking below depends on it).
    expect(Math.hypot(tsProj!.x - zigProj!.x, tsProj!.y - zigProj!.y)).toBeLessThan(1e-6);

    const park = (s: WorldState): WorldState => ({
      ...s,
      players: {
        ...s.players,
        [PlayerId(B)]: { ...s.players[PlayerId(B)]!, x: tsProj!.x, y: tsProj!.y, vx: 0, vy: 0 },
      },
    });
    tsState = park(tsState);
    zigState = park(zigState);

    let claimTick: number | null = null;
    for (let t = 0; t < 10 && claimTick === null; t++) {
      stepBoth(idle(aimAtB));
      const tsClaim = tsState.round.firstBloodPlayerId;
      const zigClaim = zigState.round.firstBloodPlayerId;
      // Never one-sided: the claim must appear on BOTH sides on the same
      // tick or on NEITHER yet.
      expect(tsClaim).toBe(zigClaim as typeof tsClaim);
      if (tsClaim !== undefined) claimTick = Number(tsState.tick);
    }
    expect(claimTick).not.toBeNull();
    expect(tsState.round.firstBloodPlayerId).toBe(PlayerId(A));
    expect(zigState.round.firstBloodPlayerId).toBe(PlayerId(A));
    // The hit was lethal — the claimant is the killer on both sides.
    expect(tsState.players[PlayerId(B)]!.alive).toBe(false);
    expect(zigState.players[PlayerId(B)]!.alive).toBe(false);

    // --- (b) BOOST. The claimant holds Right for 150 ticks (2.5s; stays
    // clear of the x=1600 wall). Pre-Z0d the TS claimant's STEADY-STATE
    // step was 1.15x Zig's — a gap GROWING ~0.9px every tick, forever
    // (the meter's "sustained divergence engine"). With the multiplier
    // mirrored, both sides saturate at the identical boosted top speed, so
    // the steady-state per-tick step must match to fp precision and the
    // position gap must FREEZE, not grow.
    //
    // What is deliberately NOT asserted: a sub-pixel absolute position
    // match across the whole window. The acceleration RAMP still differs
    // by a bounded ~23px on this path — a PRE-EXISTING full-sync engine
    // discovered while building this test (recorded in
    // multiSeedDivergence.test.ts's Z0d header entry): packWorldState
    // never writes the player_movement parallel array, so every pack
    // zeroes Zig's movement memory and its kernel runs with
    // grounded_last_frame=false — AIR_ACCELERATION ramp instead of
    // GROUND_ACCELERATION, no ground friction on the post-recoil idle
    // ticks, and no ground-jump gating. That engine is out of Z0d's
    // one-item scope; the assertions below are constructed to be
    // conclusive about the FIRST-BLOOD term specifically, which only the
    // saturated steady state isolates.
    const STEADY_FROM = 80; // both ramps (ground 11 ticks / air ~40) long done
    const WINDOW = 150;
    let maxDeltaPx = 0;
    let steadyStepDiffMax = 0;
    let gapAtSteadyStart = 0;
    let prevTsX = tsState.players[PlayerId(A)]!.x;
    let prevZigX = zigState.players[PlayerId(A)]!.x;
    for (let t = 0; t < WINDOW; t++) {
      stepBoth({
        [A]: { keys: RightBit, aim: aimAtB },
        [B]: { keys: 0, aim: { x: 100, y: 0 } },
      });
      const a = tsState.players[PlayerId(A)]!;
      const z = zigState.players[PlayerId(A)]!;
      const d = Math.hypot(a.x - z.x, a.y - z.y);
      if (d > maxDeltaPx) maxDeltaPx = d;
      if (t === STEADY_FROM) gapAtSteadyStart = a.x - z.x;
      if (t >= STEADY_FROM) {
        const stepDiff = Math.abs((a.x - prevTsX) - (z.x - prevZigX));
        if (stepDiff > steadyStepDiffMax) steadyStepDiffMax = stepDiff;
      }
      prevTsX = a.x;
      prevZigX = z.x;
    }
    const gapAtEnd =
      tsState.players[PlayerId(A)]!.x - zigState.players[PlayerId(A)]!.x;
    console.log(
      `[first-blood-parity] boost window: maxPosDelta=${maxDeltaPx.toFixed(2)}px, ` +
        `steadyStepDiffMax=${steadyStepDiffMax.toExponential(2)}px/tick, ` +
        `gap ${gapAtSteadyStart.toFixed(2)} -> ${gapAtEnd.toFixed(2)}px over the steady window`,
    );
    // Identical saturated speed = the 1.15x term is composed on BOTH sides
    // (TS's steady step provably includes it — firstBloodSuddenDeath.test.ts;
    // Zig matching it to fp precision proves its product resolves the same).
    expect(steadyStepDiffMax).toBeLessThan(1e-6);
    // The gap FREEZES once both sides saturate — the pre-Z0d engine would
    // grow it ~0.9px/tick (~63px over these 70 ticks).
    expect(Math.abs(gapAtEnd - gapAtSteadyStart)).toBeLessThan(0.01);
    // Ramp-phase offset stays bounded to the known pre-existing engine's
    // size — a regression that reopens the 15% steady-state gap trips the
    // two asserts above long before this one.
    expect(maxDeltaPx).toBeLessThan(40);
    // And the boost is genuinely ON: the claimant moved right substantially.
    expect(tsState.players[PlayerId(A)]!.x).toBeGreaterThan(400);

    // --- (c) CLEAR. Drive the round machine through its full cycle:
    // fighting → round-over → drafting → countdown → fighting. Identical
    // countdown collapse on both sides (same mutation, not a divergence
    // source), then step until both are back in a fighting phase.
    const collapse = (s: WorldState): WorldState => ({
      ...s,
      round: { ...s.round, countdownRemainingMs: 100 },
    });
    tsState = collapse(tsState);
    zigState = collapse(zigState);
    // First run the ORIGINAL fighting phase out (both sides leave it),
    // then run the round-over -> drafting -> countdown tail until both are
    // back in the NEXT round's fighting phase.
    let bothLeftFighting = false;
    for (let t = 0; t < 60 && !bothLeftFighting; t++) {
      stepBoth(idle(aimAtB));
      bothLeftFighting =
        tsState.round.phase !== "fighting" && zigState.round.phase !== "fighting";
    }
    expect(bothLeftFighting).toBe(true);
    let backInFighting = false;
    for (let t = 0; t < 1200 && !backInFighting; t++) {
      stepBoth(idle(aimAtB));
      backInFighting =
        tsState.round.phase === "fighting" && zigState.round.phase === "fighting";
    }
    expect(backInFighting).toBe(true);
    // The wager reset with the new round on BOTH sides (round.ts clears at
    // countdown→fighting; world.zig's round machine mirrors it).
    expect(tsState.round.firstBloodPlayerId).toBeUndefined();
    expect(zigState.round.firstBloodPlayerId).toBeUndefined();
  });
});
