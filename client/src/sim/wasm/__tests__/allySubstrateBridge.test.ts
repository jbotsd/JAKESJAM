// Track Z1a item 3 (convergence-goal.md Z1) — bridge + full-sync gates for
// the ally-substrate PlayerEntity growth (rally_light_until_tick /
// aegis_share_until_tick / debt_until_tick + debt_amount, offsets
// 632/636/640/648, PLAYER_ENTITY_SIZE 632 → 656).
//
// The CAST half of the four abilities (Aegis Share / Rally Light /
// Borrowed Time / Glass Ward — nearest-ally selection, isAlly gating,
// solo fallbacks, exact heal/absorb/kindling figures) is proven Zig-side
// in sim/test/smoke.zig's "ally substrate" suite, driven through the real
// stepWorld dispatch. It CANNOT be driven through this full-sync harness
// today: packWorldState leaves the player_equipped_actives parallel array
// zero-filled (bridge comment "Skipped for now"), so every full-sync
// repack strips ALL ability equipment — a recorded substrate gap (see the
// meter header's Z1a notes), not something this file papers over.
//
// What THIS file gates:
//   A. CODEC — the four new fields round-trip pack→unpack (0-sentinel →
//      undefined, debtAmount only alongside a live debtUntilTick).
//   B. FULL-SYNC BEHAVIOR, TS-vs-Zig lockstep under the every-tick
//      repack: a live Rally Light window (self-source) and a live haste
//      window (the mechanism-parity ride-along — TS composed hasteMul
//      into speedMul, Zig didn't until Z1a) drive movement IDENTICALLY on
//      both sides, and a seeded Borrowed Time debt drains exactly its
//      amount on both sides. Pre-Z1a this failed three ways: the fields
//      were wiped by the first repack (unbridged), Zig's speed_mul had no
//      haste/rally terms, and Zig had no debt resolution at all.
//
// Tick-convention note (asserted explicitly in gate B): TS's status pass
// drains debt when `debtUntilTick <= state.tick` with state.tick still
// the PRE-increment tick, while Zig's section-8b' block compares against
// the already-incremented header.tick — so for the SAME seeded absolute
// value the Zig drain lands one tick earlier. Zig CASTS compensate by
// stamping +1 (the ward_shell/self_lattice convention, world.zig), so
// live wall-clock behavior matches; a raw cross-seeded value shows the
// bare offset, and hiding it here would misrepresent how the conventions
// compose.

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
import { packWorldState, unpackWorldState } from "../worldStateBridge";
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
await applyWasmPlayerFlag();

const DT_MS = 1000 / 60;
const MAP: MapDefinition = {
  id: "ally-substrate-arena",
  name: "Ally Substrate Arena",
  size: { x: 1600, y: 900 },
  spawns: [
    { x: 300, y: 400 },
    { x: 1000, y: 400 },
  ],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 800, y: 730 }, size: { x: 1600, y: 60 } },
  ],
};

const RightBit = 1 << 1;
const P0 = PlayerId("p0");
const P1 = PlayerId("p1");

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

function makeState(): WorldState {
  return {
    tick: Tick(0),
    rngState: 1,
    players: {
      [P0]: makePlayer("p0", 300),
      [P1]: makePlayer("p1", 1000),
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
}

/** Run both orchestrators in lockstep for `ticks`, both players holding
 *  Right. Returns per-side per-tick p0-health traces + final states. */
function runLockstep(
  seed: (s: WorldState) => void,
  ticks: number,
): {
  ts: WorldState;
  zig: WorldState;
  tsHealthDropTick: number | null;
  zigHealthDropTick: number | null;
  maxPosDelta: number;
} {
  const runtime = createRuntime(MAP);
  let tsState = makeState();
  seed(tsState);

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

  const prevKeys: Record<string, number> = { p0: 0, p1: 0 };
  let tsPrev = tsState.players[P0]!.health;
  let zigPrev = zigState.players[P0]!.health;
  let tsHealthDropTick: number | null = null;
  let zigHealthDropTick: number | null = null;
  let maxPosDelta = 0;

  for (let t = 0; t < ticks; t++) {
    const keys = RightBit;
    const tsInputs: Record<PlayerId, InputFrame | null> = {};
    for (const id of ["p0", "p1"]) {
      tsInputs[PlayerId(id)] = {
        seq: InputSeq(t + 1),
        tick: Tick(t + 1),
        keys,
        aimX: 800,
        aimY: 400,
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
      ["p0", "p1"].map((id) => [
        id,
        { keys, prevKeys: prevKeys[id]!, aimX: 800, aimY: 400 },
      ]),
    );
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(zigState);
    zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;
    for (const id of ["p0", "p1"]) prevKeys[id] = keys;

    const tsH = tsState.players[P0]!.health;
    const zigH = zigState.players[P0]!.health;
    if (tsH < tsPrev && tsHealthDropTick === null) tsHealthDropTick = t;
    if (zigH < zigPrev && zigHealthDropTick === null) zigHealthDropTick = t;
    tsPrev = tsH;
    zigPrev = zigH;

    for (const id of [P0, P1]) {
      const a = tsState.players[id]!;
      const b = zigState.players[id]!;
      maxPosDelta = Math.max(
        maxPosDelta,
        Math.abs(a.x - b.x),
        Math.abs(a.y - b.y),
      );
    }
  }

  return { ts: tsState, zig: zigState, tsHealthDropTick, zigHealthDropTick, maxPosDelta };
}

describe("ally-substrate bridge (Track Z1a item 3)", () => {
  test("A. codec — the four new tail fields round-trip; absent packs as 0-sentinel → undefined", () => {
    const state = makeState();
    state.players[P0] = {
      ...state.players[P0]!,
      rallyLightUntilTick: Tick(1234),
      aegisShareUntilTick: Tick(2345),
      debtUntilTick: Tick(777),
      debtAmount: 8.5,
    };
    const unpacked = unpackWorldState(packWorldState(state));
    const p0 = unpacked.players[P0]!;
    expect(p0.rallyLightUntilTick).toBe(Tick(1234));
    expect(p0.aegisShareUntilTick).toBe(Tick(2345));
    expect(p0.debtUntilTick).toBe(Tick(777));
    expect(p0.debtAmount).toBe(8.5);
    // p1 carried none — all four decode to undefined, not zeros.
    const p1 = unpacked.players[P1]!;
    expect(p1.rallyLightUntilTick).toBeUndefined();
    expect(p1.aegisShareUntilTick).toBeUndefined();
    expect(p1.debtUntilTick).toBeUndefined();
    expect(p1.debtAmount).toBeUndefined();
  });

  test("B. full-sync lockstep — rally/haste move multipliers and the debt drain match TS under the every-tick repack", () => {
    // Baseline (no windows): where does plain movement land?
    const base = runLockstep(() => {}, 90);
    expect(base.maxPosDelta).toBeLessThan(1e-6);

    // Windowed run: p0 under its own Rally Light aura (self-source — no
    // teamId needed, matching hasRallyLightSource's solo clause) + a
    // seeded Borrowed Time debt; p1 under a haste window. Windows sit far
    // beyond the run horizon so no expiry edge lands inside the
    // measurement (the one-tick expiry-convention skew is asserted via
    // the debt below instead, where it's load-bearing).
    const windowed = runLockstep((s) => {
      s.players[P0] = {
        ...s.players[P0]!,
        rallyLightUntilTick: Tick(10_000),
        debtUntilTick: Tick(40),
        debtAmount: 8,
      };
      s.players[P1] = {
        ...s.players[P1]!,
        hasteUntilTick: Tick(10_000),
        hasteMultiplier: 1.25,
      };
    }, 90);

    // Movement parity under the repack: the multipliers compose
    // identically on both sides (pre-Z1a, Zig's speed_mul had neither
    // haste nor rally — p0/p1 walked at 1.0x under wasm authority and
    // drifted from TS within a handful of ticks).
    expect(windowed.maxPosDelta).toBeLessThan(1e-6);
    // And the windows actually ENGAGED in the ground truth (guards
    // against a trivially-green "both sides ignored it" false pass):
    // rally 1.08x / haste 1.25x both outrun the baseline walker.
    expect(windowed.ts.players[P0]!.x).toBeGreaterThan(base.ts.players[P0]!.x + 5);
    expect(windowed.ts.players[P1]!.x).toBeGreaterThan(base.ts.players[P1]!.x + 5);

    // Debt: exactly one 8-point drain on BOTH sides, cleared after.
    expect(windowed.ts.players[P0]!.health).toBe(92);
    expect(windowed.zig.players[P0]!.health).toBe(92);
    expect(windowed.ts.players[P0]!.debtUntilTick).toBeUndefined();
    expect(windowed.zig.players[P0]!.debtUntilTick).toBeUndefined();
    expect(windowed.tsHealthDropTick).not.toBeNull();
    expect(windowed.zigHealthDropTick).not.toBeNull();
    // The documented tick-convention offset (header comment): same seeded
    // absolute value → Zig lands one tick earlier; Zig CASTS stamp +1 to
    // compensate, so wall-clock behavior matches in live play.
    expect(windowed.tsHealthDropTick! - windowed.zigHealthDropTick!).toBe(1);
  });
});
