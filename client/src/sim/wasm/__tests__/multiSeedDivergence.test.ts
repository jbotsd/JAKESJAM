// Track Z0a (convergence-goal.md) — port of orphaned-branch commit 5e1676a's
// multiSeedDivergence.test.ts: the deepest correctness check in the Zig-e2e
// investigation. Drives a REALISTIC multi-player, multi-tick, multi-seed
// scripted match through BOTH orchestrators in lockstep (same inputs fed to
// each, every tick) and measures how far apart their full game state drifts.
// This is fundamentally different from every other parity test in this suite,
// which checks ONE isolated concern (a single weapon fire, a single
// fire-hazard spawn). Nothing else here exercises hundreds of consecutive
// ticks of movement + combat interacting the way a real match actually does.
//
// This test is Track Z's convergence METER, not a proven-green gate: main has
// known un-ported divergences (muzzle geometry, storm damage, player respawn
// lives TS-side only — Zig's detectRoundWinner still ends rounds on
// last-alive KO while TS's fast-respawn ruling 2026-07-17 reserves that for
// sudden death). If the sweep exceeds its bound, the per-seed record below is
// the deliverable Z0b consumes.
//
// Harness-fidelity lessons KEPT from the branch (5e1676a + 3f16fe3):
//   - setWorldArenaBounds is called (5e1676a's root-cause fix: without it,
//     Zig's void kill-plane gate is never armed → a player who falls off the
//     map dies in TS but falls forever in Zig → unbounded fake divergence).
//   - Module-level wasm state is PINNED per seed run (3f16fe3's warning: the
//     wasm module + TS backend caches are shared across every test file in
//     one bun process — statics/pads/slopes/target-score left behind by
//     another file would corrupt this measurement).
// Adaptations beyond the branch spec, closing harness gaps it still had
// (each one is a place the branch measured harness artifacts, not sim):
//   - REAL statics are wired to Zig (platformToAABB of the same MAP the TS
//     runtime collides against). The branch passed setWorldStatics([], [])
//     while TS kept the floor via its collision cache — a one-sided terrain
//     gap of exactly the kind 5e1676a itself diagnosed.
//   - setWorldLaunchPads([]) / setWorldSlopes([]) — mirrors production
//     syncWorldStaticsToWasm's always-clear cadence.
//   - setWorldTargetScore(resolveModeConfig(...)) — mirrors matchHost's
//     Z0a wiring; also pins the module cache against cross-file leakage.
//   - TRUE prevKeys are fed to Zig (branch hardcoded prevKeys: 0, making
//     every held key look freshly-pressed to Zig's edge-triggered jump/fire
//     while TS tracked real prev-keys via runtime.prevKeys).
//   - setWorldMapSize does not exist on main (the branch used it for
//     fire-hazard chaos positioning; this sweep runs no chaos modifiers) —
//     dropped, nothing consumes it here.
//
// Player movement is routed through the SAME compiled wasm stepPlayer on
// BOTH sides (TS's Layer-F backend swap, default-on in production — see
// runtime.ts applyWasmPlayerFlag). Any divergence found is attributable to
// orchestration-level differences (weapon fire, projectile motion, combat
// resolution, round machine), not movement-kernel drift, which
// longHorizonCanary covers separately.
//
// Deliberately does NOT assert byte-identity — two independently maintained
// orchestrators are not bit-exact and claiming so would be dishonest. It
// MEASURES and REPORTS divergence magnitude/onset per seed: either the
// numbers are small and bounded (strong evidence) or they're a concrete,
// reproducible failure with an exact seed to investigate next.

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
    // Center-origin (platformToAABB convention): spans x 0..1600, top at
    // y=700 — a full-width floor under every spawn. The branch's floor def
    // ({x:0,y:700}) only covered HALF the arena under this convention.
    { id: "floor", kind: "floor", position: { x: 800, y: 730 }, size: { x: 1600, y: 60 } },
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
    lastProcessedInputSeq: InputSeq(0),
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

  // Zig side — identical initial state, different object identity. Pin ALL
  // module-level wasm state per seed run (3f16fe3): the wasm instance + TS
  // backend caches are shared across every test file in this bun process.
  // Statics are the REAL floor — the exact AABBs the TS runtime's collision
  // cache is built from (createRuntime → buildStaticCache over the same
  // platforms) — so neither side has terrain the other lacks.
  setWorldStatics(
    MAP.platforms.map(platformToAABB),
    MAP.platforms.map((p) => (p.kind === "platform" ? 1 : 0)),
  );
  // Arena bounds (ceiling clamp + void kill-plane) — 5e1676a's root-cause
  // fix, mirrored from what syncWorldStaticsToWasm always does in
  // production. Without the kill-plane, Zig's void-kill gate
  // (g_kill_plane_y > 0) is never armed: a player who falls off the map
  // dies correctly in TS but stays alive-and-falling (and responding to
  // input) forever in Zig — the branch's original seed=1 unbounded-growth
  // finding (~16px/tick, 19,315px by tick 1199) was exactly this.
  setWorldArenaBounds(
    runtime.ceilingClampY,
    MAP.size.y > 0 ? MAP.size.y + KILL_PLANE_MARGIN_PX : 0,
  );
  setWorldLaunchPads([]);
  setWorldSlopes([]);
  // Spawn points (Track Z0b Item A) — mirrors syncWorldStaticsToWasm's new
  // production wiring so Zig's mid-round fast respawn seats players at the
  // SAME assignSpawnPoints seals TS uses (and pins the module cache per
  // seed run, same discipline as the other setters above).
  setWorldSpawnPoints(MAP.spawns);
  // Match win-target — mirrors matchHost's Z0a wiring (and pins the module
  // cache: suddenDeathTriggerParity.test.ts sets 3 in this same process).
  // TS's stepWithRuntime reads the identical resolveModeConfig value.
  setWorldTargetScore(resolveModeConfig(undefined).targetScore);
  let zigState: WorldState = structuredClone(tsState);

  const samples: DivergenceSample[] = [];
  let firstBigDivergenceTick: number | null = null;
  // True previous-tick keys per player — fed to Zig's input patch so its
  // edge-triggered presses (jump, fire) see the same transitions TS's
  // runtime.prevKeys tracking gives the TS orchestrator. (The branch
  // hardcoded prevKeys: 0 — every held key read as freshly-pressed, a
  // harness-only divergence source.)
  const prevKeys: Record<string, number> = {};
  for (const id of playerIds) prevKeys[id] = 0;

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
        return [id, { keys: s.keys, prevKeys: prevKeys[id]!, aimX: s.aimX, aimY: s.aimY }];
      }),
    );
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(zigState);
    zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;
    for (const id of playerIds) prevKeys[id] = scripted.get(id)!.keys;

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

describe("multi-seed TS-vs-Zig full-match divergence sweep (Track Z0a)", () => {
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
      // The branch's observed steady state (5 seeds, 2026-07-14 codebase):
      // one death-timing disagreement early, then a FLAT bounded gap for
      // the rest of the match (595-1,084px observed; 2,000px bound). A
      // dead player's position freezes wherever they died in each
      // implementation, so a one-tick death-timing disagreement leaves a
      // bounded frozen-position gap, not a growing one. Main's codebase
      // has known un-ported divergences the branch didn't (see the file
      // header) — if this bound trips, record the seeds/ticks and skip
      // per Track Z0a's meter contract rather than shipping red CI.
      expect(Number.isFinite(result.finalMaxPositionDeltaPx)).toBe(true);
      expect(result.finalMaxPositionDeltaPx).toBeLessThan(2000);
    });
  }
});
