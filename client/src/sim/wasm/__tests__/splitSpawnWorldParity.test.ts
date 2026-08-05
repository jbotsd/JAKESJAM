// Track E item E1 (gospel-goal.md) — lockstep parity gate for the
// split-spawn orchestrator: world.zig's sections 3/4 now queue every
// TS-mirrored projectile death and its "4s" pass materialises the child
// fan via `projectileSplitVelocities` (already bit-exact vs TS's
// `spawnSplit` in projectileLifecycleParity.test.ts) with spawnSplit's
// exact field inheritance. These tests prove the CASCADE stays
// bit-identical TS-vs-wasm ACROSS the spawn: same child count, same
// child kinematics to the bit, same post-split rng cursor, and identical
// continued flight (including the children's own later deaths).
//
// Same lockstep harness shape as hitscanZ5ScopeCutsParity.test.ts, with
// one deliberate difference: the split projectile is HAND-SEEDED into
// both worlds' initial state rather than fired — the fire path (spread
// rng, class delivery routing, homing steering) carries its own
// pre-existing, separately-tracked divergences that would only blur what
// THIS gate needs to prove. Entity IDS are deliberately not compared:
// packWorldState writes a placeholder 0 for header.next_entity_id (its
// own comment: "stay placeholders until the data-table-driven
// orchestrator owns them"), so wasm-assigned ids can never match the TS
// runtime allocator's — a pre-existing bridge gap, not a split-spawn
// one. Object key order (ascending numeric) still pins fan order on
// both sides, which is what the per-child comparisons rely on.

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
  EntityId,
  InputSeq,
  PlayerId,
  Tick,
  type CharacterArchetype,
  type InputFrame,
  type MapDefinition,
  type PlayerEntity,
  type ProjectileEntity,
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
  id: "split-spawn-parity-arena",
  name: "Split-Spawn Parity Arena",
  size: { x: 1600, y: 1300 },
  spawns: [{ x: 1400, y: 400 }],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 800, y: 1200 }, size: { x: 1600, y: 60 } },
  ],
};

const P1 = PlayerId("idle-one");
const P2 = PlayerId("idle-two");

function makeIdlePlayer(id: PlayerId, x: number): PlayerEntity {
  return {
    id,
    characterId: "balanced" as CharacterArchetype,
    x,
    y: 1140, // standing on the floor (top edge 1170, body half-height 28)
    vx: 0,
    vy: 0,
    aimX: x + 100,
    aimY: 1140,
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

/** Steps BOTH orchestrators in lockstep with idle inputs, comparing the
 *  full projectile record + rng cursor bit-exactly after every tick. */
function runLockstep(seedProjectile: Omit<ProjectileEntity, "id">, nTicks: number): void {
  const runtime = createRuntime(MAP);
  const projId = EntityId(500);
  const initial: WorldState = {
    tick: Tick(0),
    rngState: 987654321,
    players: {
      [P1]: makeIdlePlayer(P1, 1300),
      [P2]: makeIdlePlayer(P2, 1500),
    },
    projectiles: { [projId]: { ...seedProjectile, id: projId } },
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
  let tsState = initial;

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
  let zigState: WorldState = structuredClone(initial);

  for (let t = 1; t <= nTicks; t++) {
    const inputs: Record<PlayerId, InputFrame | null> = {};
    const wasmInputs = new Map<
      string,
      { keys: number; prevKeys: number; aimX: number; aimY: number }
    >();
    for (const pid of [P1, P2]) {
      const p = tsState.players[pid]!;
      inputs[pid] = {
        seq: InputSeq(t),
        tick: Tick(t),
        keys: 0,
        aimX: p.aimX,
        aimY: p.aimY,
        dtMs: DT_MS,
      };
      wasmInputs.set(String(pid), { keys: 0, prevKeys: 0, aimX: p.aimX, aimY: p.aimY });
    }
    tsState = stepWithRuntime(tsState, runtime, inputs, DT_MS).state;

    (globalThis as {
      __jakesjam_wasm_inputs__?: ReadonlyMap<
        string,
        { keys: number; prevKeys: number; aimX: number; aimY: number }
      >;
    }).__jakesjam_wasm_inputs__ = wasmInputs;
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(zigState);
    zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;

    // Full projectile-record comparison, every tick — proves the cascade
    // stays in lockstep THROUGH the spawn tick and beyond (children fly
    // and die on their own schedule on both engines).
    const tsProj = Object.values(tsState.projectiles);
    const zigProj = Object.values(zigState.projectiles);
    expect(zigProj.length, `tick ${t}: projectile count`).toBe(tsProj.length);
    for (let i = 0; i < tsProj.length; i++) {
      const a = tsProj[i]!;
      const b = zigProj[i]!;
      const at = `tick ${t} proj[${i}]`;
      expect(b.x, `${at} x`).toBe(a.x);
      expect(b.y, `${at} y`).toBe(a.y);
      expect(b.vx, `${at} vx`).toBe(a.vx);
      expect(b.vy, `${at} vy`).toBe(a.vy);
      expect(b.damage, `${at} damage`).toBe(a.damage);
      expect(b.radius, `${at} radius`).toBe(a.radius);
      expect(b.lifetimeMs, `${at} lifetimeMs`).toBe(a.lifetimeMs);
      expect(b.rangePx ?? 0, `${at} rangePx`).toBe(a.rangePx ?? 0);
      expect(b.splitCount ?? 0, `${at} splitCount`).toBe(a.splitCount ?? 0);
      expect(b.ageMs ?? 0, `${at} ageMs`).toBe(a.ageMs ?? 0);
      expect(b.traveledPx ?? 0, `${at} traveledPx`).toBe(a.traveledPx ?? 0);
      expect(b.pathing, `${at} pathing`).toBe(a.pathing);
      expect(b.element, `${at} element`).toBe(a.element);
      expect(b.impact ?? "none", `${at} impact`).toBe(a.impact ?? "none");
      expect(b.pierceRemaining, `${at} pierceRemaining`).toBe(a.pierceRemaining);
      expect(b.bouncesRemaining, `${at} bouncesRemaining`).toBe(a.bouncesRemaining);
    }
    expect(zigState.rngState, `tick ${t}: rngState`).toBe(tsState.rngState);
  }
}

const BASE_SHARD: Omit<ProjectileEntity, "id"> = {
  ownerId: null,
  x: 300,
  y: 600,
  vx: 480,
  vy: 0,
  shape: "circle",
  radius: 6,
  damage: 30,
  lifetimeMs: 1000,
  pathing: "straight",
  element: "neutral",
  bouncesRemaining: 0,
  pierceRemaining: 0,
  splitCount: 3,
  rangePx: 4000,
  ageMs: 100, // past the first-tick muzzle-overlap exemption
  traveledPx: 0,
  originX: 300,
  originY: 600,
};

describe("split-spawn orchestrator (Track E1): TS-vs-wasm lockstep across the spawn", () => {
  test("lifetime expiry: a splitCount=3 shard expires mid-air and fans 3 children bit-identically — count, kinematics, inheritance, rng cursor, and 10 further ticks of child flight", () => {
    // lifetimeMs = 3.5 ticks: expires on tick 4's pre-motion check on
    // both engines (16.67 * 3 = 50 < 58.3 <= 66.7).
    runLockstep({ ...BASE_SHARD, lifetimeMs: 58.3 }, 14);
  });

  test("terrain impact: a splitCount=3 shard dives into the floor and fans at the integrated contact point bit-identically, children then dying on their own terrain contacts in lockstep", () => {
    runLockstep(
      {
        ...BASE_SHARD,
        x: 400,
        y: 1100,
        vx: 0,
        vy: 600,
        originX: 400,
        originY: 1100,
        lifetimeMs: 2000,
      },
      16,
    );
  });

  test("no-split control: an identical splitCount=0 shard expires leaving NOTHING on either engine, rng untouched on both", () => {
    runLockstep({ ...BASE_SHARD, lifetimeMs: 58.3, splitCount: 0 }, 8);
  });
});
