// Track Z1c "ninja dash i-frames" item (convergence-goal.md) — parity gate
// for world.zig's new `isNinjaEvading` (port of combat.ts's
// `tryDeflectDamage` step 0.5: "ninja = evasion — dash i-frames — never
// blocks, only isn't there"), wired ahead of Ghost Guard at every damage-
// resolution site: the real-projectile hit site, the hitscan hit site
// (Track Z1c item 1), `resolveInstantAoeCasts`, and `stepMeleeSwing`.
//
// Substrate note: `state.player_movement[idx].dash_active_ms > 0.0` IS the
// derived Zig equivalent of TS's `player.dashing === true` (player.ts:288
// — `dashing: memory.dashActiveMs > 0`) — no new PlayerMovementMemory
// field was needed, just a reader at the damage sites. Both engines'
// movement memory are seeded directly here (`runtime.movement` for TS,
// `WorldState.movementMemory` for Zig — see PlayerMovementMemory's own
// "two carriers" doc comment in types.ts) rather than driven through a
// real dash-input sequence, for a fully deterministic, single-purpose
// scenario.

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
import { KILL_PLANE_MARGIN_PX, freshPlayerMovementMemory } from "../../player";
import { platformToAABB } from "../../collision";
import { resolveModeConfig } from "../../data/modeConfig";
import { starterWeapon } from "../../data/weapons";
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
  type PlayerMovementMemory,
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
  id: "ninja-iframes-parity-arena",
  name: "Ninja I-Frames Parity Arena",
  size: { x: 1600, y: 900 },
  spawns: [{ x: 700, y: 400 }],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 800, y: 450 }, size: { x: 1600, y: 60 } },
  ],
};

const ATTACKER = PlayerId("attacker");
const VICTIM = PlayerId("victim");
const Y = 400;
const ATTACKER_X = 700;
const VICTIM_X = 900;
const STARTER_DAMAGE = starterWeapon.damage;

const FireBit = 1 << 6;
// Generous — well over what a handful of ticks' worth of dt decay could
// ever exhaust, so this scenario never has to worry about pre/post-decay
// ordering between the movement step and the damage-resolution read.
const DASHING_MS = 500;

function makePlayer(
  id: PlayerId,
  x: number,
  characterId: CharacterArchetype,
  aimX: number,
  aimY: number,
): PlayerEntity {
  return {
    id,
    characterId,
    x,
    y: Y,
    vx: 0,
    vy: 0,
    aimX,
    aimY,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 0,
    ammo: 999,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    jetpackFuel: 0,
  };
}

function makeState(victimCharacterId: CharacterArchetype, victimDashing: boolean): {
  state: WorldState;
  movement: PlayerMovementMemory;
} {
  const movement: PlayerMovementMemory = {
    ...freshPlayerMovementMemory(),
    dashActiveMs: victimDashing ? DASHING_MS : 0,
  };
  return {
    state: {
      tick: Tick(0),
      rngState: 1,
      players: {
        [ATTACKER]: makePlayer(ATTACKER, ATTACKER_X, "balanced", VICTIM_X, Y),
        [VICTIM]: makePlayer(VICTIM, VICTIM_X, victimCharacterId, VICTIM_X + 100, Y),
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
      movementMemory: { [VICTIM]: movement },
    },
    movement,
  };
}

/** Run `nTicks` of the attacker holding Fire (hitscan — starterWeapon is
 *  raycast for every class-blind character) at a stationary victim, with
 *  the victim's dash memory seeded on BOTH engines before the first tick.
 *  Returns each side's final victim health. */
function runHitscan(victimCharacterId: CharacterArchetype, victimDashing: boolean, nTicks = 5): {
  tsHealth: number;
  zigHealth: number;
} {
  const runtime = createRuntime(MAP);
  const { state: initial, movement } = makeState(victimCharacterId, victimDashing);
  let tsState = initial;
  // TS's own carrier for movement memory is the RUNTIME (WorldRuntime.
  // movement), never WorldState on the stepWithRuntime path — see
  // PlayerMovementMemory's "two carriers" doc comment.
  runtime.movement.set(VICTIM, movement);

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
    const inputs: Record<PlayerId, InputFrame | null> = {
      [ATTACKER]: {
        seq: InputSeq(t),
        tick: Tick(t),
        keys: FireBit,
        aimX: VICTIM_X,
        aimY: Y,
        dtMs: DT_MS,
      },
      [VICTIM]: {
        seq: InputSeq(t),
        tick: Tick(t),
        keys: 0,
        aimX: VICTIM_X + 100,
        aimY: Y,
        dtMs: DT_MS,
      },
    } as Record<PlayerId, InputFrame | null>;

    tsState = stepWithRuntime(tsState, runtime, inputs, DT_MS).state;

    (globalThis as {
      __jakesjam_wasm_inputs__?: ReadonlyMap<
        string,
        { keys: number; prevKeys: number; aimX: number; aimY: number }
      >;
    }).__jakesjam_wasm_inputs__ = new Map([
      [String(ATTACKER), { keys: FireBit, prevKeys: t > 1 ? FireBit : 0, aimX: VICTIM_X, aimY: Y }],
      [String(VICTIM), { keys: 0, prevKeys: 0, aimX: VICTIM_X + 100, aimY: Y }],
    ]);
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(zigState);
    zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;
  }

  return {
    tsHealth: tsState.players[VICTIM]!.health,
    zigHealth: zigState.players[VICTIM]!.health,
  };
}

/** A REAL, already-in-flight `ProjectileEntity` injected directly into
 *  `state.projectiles` (bypassing weapon-fire/card resolution entirely —
 *  no class can reliably reach this path via its own Fire button: Wizard
 *  is FORCED raycast regardless of any card ("THE GEOMETRICIAN RULING"),
 *  Ninja/Paladin's Fire triggers their melee verb instead, and Priest's
 *  own tendril is homing + multi-count + avoidance-steered, none of which
 *  reliably CONNECTS against a stationary target within any bounded tick
 *  budget in a plain test harness — verified directly: a real 90-tick run
 *  never landed a single hit). Straight pathing, no homing, aimed dead-on
 *  20px from the victim at a speed that guarantees a same-tick-ish
 *  arrival — the section-4 hit site under test doesn't care how the
 *  projectile came to exist, only that it's there and about to connect. */
function makeIncomingProjectile(): ProjectileEntity {
  return {
    id: EntityId(9001),
    ownerId: ATTACKER,
    x: VICTIM_X - 20,
    y: Y,
    vx: 400,
    vy: 0,
    shape: "circle",
    radius: 7,
    damage: STARTER_DAMAGE,
    lifetimeMs: 1000,
    pathing: "straight",
    element: "crystal",
    bouncesRemaining: 0,
    pierceRemaining: 0,
  };
}

function runRealProjectile(victimDashing: boolean, nTicks = 5): {
  tsHealth: number;
  zigHealth: number;
} {
  const runtime = createRuntime(MAP);
  const { state: initial, movement } = makeState("sprinter", victimDashing);
  const proj = makeIncomingProjectile();
  const withProjectile: WorldState = {
    ...initial,
    projectiles: { [proj.id]: proj },
  };
  let tsState = withProjectile;
  runtime.movement.set(VICTIM, movement);

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
  let zigState: WorldState = structuredClone(withProjectile);

  for (let t = 1; t <= nTicks; t++) {
    const inputs: Record<PlayerId, InputFrame | null> = {
      [ATTACKER]: { seq: InputSeq(t), tick: Tick(t), keys: 0, aimX: VICTIM_X, aimY: Y, dtMs: DT_MS },
      [VICTIM]: { seq: InputSeq(t), tick: Tick(t), keys: 0, aimX: VICTIM_X + 100, aimY: Y, dtMs: DT_MS },
    } as Record<PlayerId, InputFrame | null>;

    tsState = stepWithRuntime(tsState, runtime, inputs, DT_MS).state;

    (globalThis as {
      __jakesjam_wasm_inputs__?: ReadonlyMap<
        string,
        { keys: number; prevKeys: number; aimX: number; aimY: number }
      >;
    }).__jakesjam_wasm_inputs__ = new Map([
      [String(ATTACKER), { keys: 0, prevKeys: 0, aimX: VICTIM_X, aimY: Y }],
      [String(VICTIM), { keys: 0, prevKeys: 0, aimX: VICTIM_X + 100, aimY: Y }],
    ]);
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(zigState);
    zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;
  }

  return {
    tsHealth: tsState.players[VICTIM]!.health,
    zigHealth: zigState.players[VICTIM]!.health,
  };
}

describe("ninja dash i-frames parity (Track Z1c ninja dash i-frames item)", () => {
  test("a dashing Ninja evades a hitscan hit entirely on both engines", () => {
    const { tsHealth, zigHealth } = runHitscan("sprinter", true);
    expect(tsHealth, "TS: fully evaded, no damage").toBe(100);
    expect(zigHealth, "Zig: fully evaded, no damage").toBe(100);
  });

  test("control: a NON-dashing Ninja takes the normal hit on both engines (proves the gate, not an always-evade bug)", () => {
    const { tsHealth, zigHealth } = runHitscan("sprinter", false);
    expect(tsHealth, "TS: normal hit lands").toBeCloseTo(100 - STARTER_DAMAGE, 9);
    expect(zigHealth, "Zig: normal hit lands").toBeCloseTo(100 - STARTER_DAMAGE, 9);
  });

  test("control: a dashing NON-ninja (dash_active_ms alone, wrong class) still takes the normal hit on both engines (proves the class gate)", () => {
    const { tsHealth, zigHealth } = runHitscan("balanced", true);
    expect(tsHealth, "TS: wizard 'dashing' grants no evasion").toBeCloseTo(100 - STARTER_DAMAGE, 9);
    expect(zigHealth, "Zig: wizard 'dashing' grants no evasion").toBeCloseTo(100 - STARTER_DAMAGE, 9);
  });

  test("a dashing Ninja ALSO evades a real (traveling) ProjectileEntity hit on both engines", () => {
    const { tsHealth, zigHealth } = runRealProjectile(true);
    expect(tsHealth, "TS: fully evaded, no damage").toBe(100);
    expect(zigHealth, "Zig: fully evaded, no damage").toBe(100);
  });

  test("control: a NON-dashing Ninja takes real-projectile damage on both engines", () => {
    const { tsHealth, zigHealth } = runRealProjectile(false);
    expect(tsHealth, "TS: normal hit lands").toBeLessThan(100);
    expect(zigHealth, "Zig: normal hit lands").toBeLessThan(100);
  });
});
