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
// This test is Track Z's convergence METER, not a proven-green gate. Z0b
// (2026-07-23) ported fast-respawn round semantics + muzzle geometry +
// the shrink-zone storm and got finals down to 329/185/445/278/361px
// (from 1067/217/867/1043/376 at the Z0a baseline), leaving two evidenced
// hypotheses: the missing fire-recoil substrate and the un-ported
// tick-order reorder. Z0c (2026-07-23) built BOTH and the meter got
// WORSE — recorded honestly, with the per-item split:
//
//   Z0c BEFORE (Z0b's after):   AFTER Item A (recoil):  AFTER A+B (reorder):
//   seed=1     : final  329px | final 1696px           | final 1696px
//   seed=42    : final  185px | final 1562px           | final 1562px
//   seed=1337  : final  445px | final 1246px           | final 1246px
//   seed=90210 : final  278px | final 1661px           | final 1661px
//   seed=271828: final  361px | final  898px           | final 1147px
//
// What the numbers do NOT mean: the ports themselves are wrong. Both are
// proven at the micro level — the recoil kick is bit-identical per shot
// (throwaway TS-vs-Zig probe during Z0c: shooter vx/vy equal to 1e-9),
// and a shot fired at tick T now travels the IDENTICAL distance on both
// sides at T (tickOrderParity.test.ts asserts full position+age equality,
// 47.3221px both sides — its old "Zig integrates one tick late" carve-out
// is deleted). Pre-death samples confirm it: t=60 deltas are equal or
// slightly better than Z0b's on every seed. Item B on top of Item A
// changed almost nothing in this sweep (one sample on one seed) — the
// one-tick flight skew was never this harness's dominant term.
//
// Why the finals exploded anyway — the NEXT evidenced hypothesis, both
// halves verified in-code during Z0c: the blowup starts at the FIRST
// death-timing disagreement on every seed and never re-converges, because
// (1) TS grants the round's first-blood killer a PERSISTENT 1.15x
// move-speed multiplier (World.ts:2532 `firstBloodMul`, round.ts:37
// FIRST_BLOOD_SPEED_MULTIPLIER) with NO Zig mirror at all (grepped: the
// only `first_blood` in sim/src is a comment) — after the first kill the
// TS-side killer walks 15% faster than its Zig twin for the REST of the
// round, a sustained divergence engine that recoil's velocity coupling
// now compounds on every shot (before Z0c the un-kicked Zig shooter's
// friction-anchored drift plateaued near 161-330px; kicks at
// slightly-different muzzle angles turn that plateau into growth); and
// (2) respawn seat choice is position-dependent (assignedSpawnPoint's
// greedy farthest-from-roster placement, mirroring TS assignSpawnPoints)
// — once death ticks diverge, the two sims re-seat the same player at
// DIFFERENT spawn seals, which is exactly the 1400-1700px step-plateaus
// in the samples. First-blood is the next port target; it is small,
// self-contained state (round.firstBloodPlayerId + one speed_mul term).
//
// Z0d (2026-07-23) built exactly that port — first-blood is now fully
// mirrored (WorldStateHeader.first_blood_idx_plus1 + the section-4/chain
// award sites + both round-machine clears + the speed_mul term + bridge
// round-trip and the first_blood wasm event; firstBloodParity.test.ts
// proves claim tick, claimant, clearing semantics, AND an exactly-equal
// boosted steady-state step across the boundary) — and the meter did not
// move:
//
//   Z0d BEFORE (Z0c's after):    AFTER first-blood mirror:
//   seed=1     : final 1696px  | final 1696.0px
//   seed=42    : final 1562px  | final 1561.8px
//   seed=1337  : final 1246px  | final 1246.4px
//   seed=90210 : final 1661px  | final 1667.5px
//   seed=271828: final 1147px  | final 1147.1px
//
// VERDICT: hypothesis MISS at the meter level. The mechanism was real and
// is proven ported at the micro level, but it never got the chance to be
// this harness's dominant term: every seed crosses 200px of divergence
// within 98-171 ticks (1.6-2.9s) while health/alive mismatches are still
// ZERO — movement alone forks the sims long before the first death, so a
// per-round post-kill 15% walk-speed edge is noise here.
//
// Why movement forks — the NEXT evidenced hypothesis, all three legs
// verified in-code during Z0d: the full-sync path ZEROES Zig's movement
// MEMORY every tick. packWorldState never writes the player_movement
// parallel array (worldStateBridge.ts leaves that region zero-filled in
// the packed buffer; unpack just skips it), and runWasmStepSync /
// serverWasmHost overwrite the ENTIRE WorldState buffer with that packed
// image before every step_world call — so Zig's stepPlayer runs every
// tick with grounded_last_frame=false and blank coyote/jump-buffer/
// air-jump/dash memory, while TS's runtime.movement Map persists the real
// memory across ticks. Concretely (probed while building
// firstBloodParity.test.ts): (1) grounded players accelerate with
// AIR_ACCELERATION instead of GROUND_ACCELERATION (player.zig:312) —
// measured ramp 0.65 vs 0.86 px/tick^2, a bounded ~23px offset per
// movement burst; (2) ground friction never applies (player.zig:314) — an
// idle post-recoil shooter keeps vx=-92.9 on the Zig side while TS decays
// it 60/tick; (3) ground jumps are IMPOSSIBLE Zig-side (every jump branch
// gates on grounded/coyote/air-jump memory) while this sweep's scripted
// bots press Jump on ~10% of ticks — each press forks the two sims'
// y-trajectories outright. The fix is small and mechanical — persist the
// movement-memory region across packs (copy it back from the prior
// wasm-side state after heap.set, or pack/unpack it like any other
// array) — but it touches BOTH hosts' pack cadence, a substrate change
// that is its own track item, not part of Z0d's one-item scope.
//
// Z0e (2026-07-23) built exactly that — the bridge now packs AND unpacks
// the player_movement parallel array (worldStateBridge.ts, keyed by
// player id via the new `WorldState.movementMemory` carrier; both hosts'
// mergeUnpacked ride it between packs; movementMemoryBridge.test.ts
// proves layout vs wasm's @offsetOf, codec round-trip, and the Z0d probe
// shape as a lockstep gate: idle vx decays to exactly 0 both sides,
// ground jumps fire again) — and the meter moved MORE than any port so
// far, the largest tightening of the whole harvest:
//
//   Z0e BEFORE (Z0d's after):    AFTER movement-memory bridge:
//   seed=1     : final 1696.0px | final  376.5px
//   seed=42    : final 1561.8px | final  196.2px
//   seed=1337  : final 1246.4px | final  449.6px
//   seed=90210 : final 1667.5px | final  280.4px
//   seed=271828: final 1147.1px | final  378.0px
//
// VERDICT: hypothesis CONFIRMED. Onset of >200px divergence moved from
// 98-171 ticks (1.6-2.9s, pre-death, movement-only) out to 181-309 ticks
// (3.0-5.2s), and the t=60 samples now read 0.0-23.5px (previously
// 60-160px+): movement alone no longer forks the sims. Finals now sit
// BELOW the orphan branch's own observed steady state (595-1,084px on
// its 2026-07-14 codebase). LIVE-MODE IMPLICATION, confirmed in-code:
// this was never harness-only — matchHost's USE_WASM_STEP_WORLD path
// and the client's ?wasm-world=2 path both repack every tick, so live
// Zig authority ran with no ground friction, ground-jumps impossible,
// and air-acceleration on the ground — a direct mechanical explanation
// for part of the 2026-07-06 "wrong-feeling movement / Zig version is
// garbage" verdict that reverted the Zig default.
//
// NEXT evidenced hypothesis (Z0e observations): the remaining pattern is
// step-plateaus (recurring ~160-164px and larger) whose onsets coincide
// with health/alive-mismatch windows — death-TICK disagreements (small
// residual combat deltas: seed=1337 already shows healthΔ=14.4 at t=60
// while positions still track within 8px, i.e. borderline hit-resolution
// flips) amplified by position-dependent respawn seating (Z0c finding
// (2): once death ticks diverge, assignedSpawnPoint's farthest-from-
// roster greedy re-seats the same player at DIFFERENT seals). The dead-
// player frozen-position gap + seat gap dominate every sample >150px.
// Also known and deliberately NOT fixed here (same bug class, separate
// item): the melee_swing parallel array is still zeroed by every pack —
// irrelevant to this sweep (scripted bots never melee) but the swing FSM
// can never leave windup on the live wasm path.
//
// If the sweep exceeds its bound, the per-seed record above is the
// deliverable the next track consumes.
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
