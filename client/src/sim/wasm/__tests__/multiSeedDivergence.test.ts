// Zig e2e cutover investigation, 2026-07-14 — the deepest correctness check
// in this investigation: drives a REALISTIC multi-player, multi-tick,
// multi-seed scripted match through BOTH orchestrators in lockstep (same
// inputs fed to each, every tick) and measures how far apart their full
// game state drifts. This is fundamentally different from every other
// parity test in this suite, which checks ONE isolated concern (a single
// weapon fire, a single storm-damage tick, a single fire-hazard spawn).
// Nothing else here exercises hundreds of consecutive ticks of movement +
// combat interacting the way a real match actually does.
//
// Full findings, including the seed=1 unbounded-divergence result this
// test surfaces (real, reproducible, not yet root-caused as of 2026-07-14):
// docs/zig-e2e-cutover-investigation-2026-07-14.md.
//
// Player movement is routed through the SAME compiled wasm stepPlayer on
// BOTH sides (TS's existing Layer-F backend swap, already default-on in
// production — see client/src/sim/wasm/runtime.ts applyWasmPlayerFlag).
// That's not a test artifact to make this pass artificially — it's already
// how the game actually runs today. So any divergence this test finds is
// specifically attributable to orchestration-level differences (weapon
// fire, projectile motion, combat resolution, chaos modifiers), not
// movement-kernel drift, which is a separately and thoroughly parity-tested
// concern (worldLongHorizon.test.ts).
//
// Deliberately does NOT assert byte-identity — two independently
// maintained ~1000+ line orchestrators are not guaranteed to be bit-exact
// after one investigation session's worth of fixes, and claiming otherwise
// without exhaustive proof would be dishonest. Instead this MEASURES and
// REPORTS divergence magnitude/onset across N seeds, which is itself real
// evidence: either the numbers are small and bounded (strong evidence the
// fixes landed correctly) or they're not (a concrete, reproducible failure
// to investigate next, with an exact seed to reproduce it).

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import {
  preloadWasmWorldSim,
  applyWasmWorldStepFullSync,
  setWorldMapSize,
  setWorldStatics,
} from "../worldWasmBackend";
import { wasmHost } from "../wasmHost";
import { applyWasmPlayerFlag } from "../runtime";
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
await applyWasmPlayerFlag(); // TS movement now runs the SAME wasm stepPlayer Zig uses

const PLAYER_COUNT = 4;
const DT_MS = 1000 / 60;
const TICKS = 1200; // 20 real seconds at 60Hz — long enough for many fire/move cycles
const MAP: MapDefinition = {
  id: "divergence-test-arena",
  name: "Divergence Test Arena",
  size: { x: 1600, y: 900 },
  spawns: Array.from({ length: PLAYER_COUNT }, (_, i) => ({
    x: 300 + i * 250,
    y: 400,
  })),
  platforms: [
    { id: "floor", kind: "floor", position: { x: 0, y: 700 }, size: { x: 1600, y: 60 } },
  ],
};

const LeftBit = 1 << 0;
const RightBit = 1 << 1;
const JumpBit = 1 << 4;
const FireBit = 1 << 6;

/** Deterministic per-player LCG — same scripted-bot pattern as
 *  tests/e2e/playtest-bots.spec.ts, reimplemented here since that file runs
 *  under Playwright, not bun:test. */
function makeLcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function scriptedInputsForTick(
  seed: number,
  tick: number,
  playerIds: string[],
): Map<string, { keys: number; aimX: number; aimY: number }> {
  const out = new Map<string, { keys: number; aimX: number; aimY: number }>();
  for (let pi = 0; pi < playerIds.length; pi++) {
    const rng = makeLcg(seed * 7919 + pi * 104729 + Math.floor(tick / 30));
    const r1 = rng();
    const r2 = rng();
    let keys = 0;
    if (r1 < 0.35) keys |= LeftBit;
    else if (r1 < 0.7) keys |= RightBit;
    if (r2 < 0.1) keys |= JumpBit;
    if (rng() < 0.4) keys |= FireBit;
    out.set(playerIds[pi]!, {
      keys,
      aimX: 200 + rng() * 1200,
      aimY: 300 + rng() * 300,
    });
  }
  return out;
}

function makePlayer(id: string, x: number): PlayerEntity {
  return {
    id: PlayerId(id),
    characterId: "balanced",
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
    cards: [],
    fireCooldownMs: 0,
    ammo: 12,
    abilityCharge: 0,
    lastProcessedInputSeq: 0 as never,
    jetpackFuel: 0,
  };
}

type DivergenceSample = {
  tick: number;
  maxPositionDeltaPx: number;
  maxHealthDelta: number;
  aliveMismatchCount: number;
};

async function runOneSeed(seed: number): Promise<{
  samples: DivergenceSample[];
  finalMaxPositionDeltaPx: number;
  firstBigDivergenceTick: number | null;
}> {
  const playerIds = Array.from({ length: PLAYER_COUNT }, (_, i) => `p${i}`);

  // TS side
  const runtime = createRuntime(MAP);
  let tsState: WorldState = {
    tick: Tick(0),
    rngState: seed,
    players: Object.fromEntries(
      playerIds.map((id, i) => [PlayerId(id), makePlayer(id, 300 + i * 250)]),
    ) as Record<PlayerId, PlayerEntity>,
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    round: { phase: "fighting", countdownRemainingMs: 90_000, scores: {}, roundIndex: 1, winnerPlayerId: null },
  };

  // Zig side — identical initial state, different object identity.
  setWorldStatics([], []); // flat floor only; Zig's static-AABB cache isn't
  // wired through this test harness, so both sides effectively fly free —
  // an intentional scope limit (isolates this run to orchestration-level
  // divergence, not terrain-collision parity, which longHorizonCanary
  // already covers). Documented, not silently worked around.
  setWorldMapSize(MAP.size.x, MAP.size.y);
  let zigState: WorldState = structuredClone(tsState);

  const samples: DivergenceSample[] = [];
  let firstBigDivergenceTick: number | null = null;

  for (let t = 0; t < TICKS; t++) {
    const scripted = scriptedInputsForTick(seed, t, playerIds);

    // TS step
    const tsInputs: Record<PlayerId, InputFrame | null> = {};
    for (const id of playerIds) {
      const s = scripted.get(id)!;
      tsInputs[PlayerId(id)] = {
        seq: InputSeq(t + 1),
        tick: Tick(t + 1),
        keys: s.keys,
        aimX: s.aimX,
        aimY: s.aimY,
        dtMs: DT_MS,
      };
    }
    tsState = stepWithRuntime(tsState, runtime, tsInputs, DT_MS).state;

    // Zig step — same scripted inputs, via the global input stash.
    (globalThis as {
      __jakesjam_wasm_inputs__?: ReadonlyMap<
        string,
        { keys: number; prevKeys: number; aimX: number; aimY: number }
      >;
    }).__jakesjam_wasm_inputs__ = new Map(
      playerIds.map((id) => {
        const s = scripted.get(id)!;
        return [id, { keys: s.keys, prevKeys: 0, aimX: s.aimX, aimY: s.aimY }];
      }),
    );
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(zigState);
    zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;

    // Compare.
    let maxPos = 0;
    let maxHealth = 0;
    let aliveMismatch = 0;
    for (const id of playerIds) {
      const a = tsState.players[PlayerId(id)];
      const b = zigState.players[PlayerId(id)];
      if (!a || !b) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > maxPos) maxPos = d;
      const hd = Math.abs(a.health - b.health);
      if (hd > maxHealth) maxHealth = hd;
      if (a.alive !== b.alive) aliveMismatch++;
    }
    if (t % 60 === 0 || t === TICKS - 1) {
      samples.push({ tick: t, maxPositionDeltaPx: maxPos, maxHealthDelta: maxHealth, aliveMismatchCount: aliveMismatch });
    }
    if (firstBigDivergenceTick === null && maxPos > 200) {
      firstBigDivergenceTick = t;
    }
  }

  return {
    samples,
    finalMaxPositionDeltaPx: samples[samples.length - 1]!.maxPositionDeltaPx,
    firstBigDivergenceTick,
  };
}

describe("multi-seed TS-vs-Zig full-match divergence sweep (2026-07-14)", () => {
  const SEEDS = [1, 42, 1337, 90210, 271828];

  for (const seed of SEEDS) {
    test(`seed=${seed}: ${TICKS} ticks, ${PLAYER_COUNT} players, movement+combat`, async () => {
      const result = await runOneSeed(seed);
      console.log(
        `[divergence-sweep seed=${seed}] samples:`,
        result.samples
          .map(
            (s) =>
              `t=${s.tick} maxPosΔ=${s.maxPositionDeltaPx.toFixed(1)}px maxHealthΔ=${s.maxHealthDelta.toFixed(1)} aliveMismatch=${s.aliveMismatchCount}`,
          )
          .join(" | "),
      );
      if (result.firstBigDivergenceTick !== null) {
        console.log(
          `[divergence-sweep seed=${seed}] FIRST >200px divergence at tick ${result.firstBigDivergenceTick} (${(result.firstBigDivergenceTick / 60).toFixed(1)}s into the match)`,
        );
      }
      // Findings as of 2026-07-14 (see the KNOWN-DIVERGENCE doc note this
      // test's own file header points to): 4/5 seeds show a BOUNDED
      // divergence — position gap jumps once (usually within the first
      // ~40 ticks, consistent with a death/damage-timing disagreement)
      // then stays flat for the rest of the match, which is explicable
      // (a dead player's position freezes wherever they died in each
      // implementation, and if that differs by even one tick the frozen
      // positions differ by a bounded amount forever after). Seed=1 is
      // qualitatively different: UNBOUNDED linear growth (~16px/tick,
      // i.e. one implementation has a player still alive-and-moving
      // while the other has them dead-and-frozen) — a real, reproducible,
      // not-yet-root-caused combat/death-resolution divergence. Rerun
      // with SEEDS=[1] and read the full per-60-tick sample log above to
      // reproduce.
      //
      // This assertion is a sanity backstop only (catch a genuine
      // simulation blowup / NaN state), NOT a claim of parity — an
      // aliveMismatch-driven divergence like seed=1's is real and
      // tracked, not swept under a loose bound.
      expect(Number.isFinite(result.finalMaxPositionDeltaPx)).toBe(true);
      expect(result.finalMaxPositionDeltaPx).toBeLessThan(100_000);
    });
  }
});
