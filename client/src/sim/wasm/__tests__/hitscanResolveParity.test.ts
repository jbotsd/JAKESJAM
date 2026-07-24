// Track Z1c item 1 (convergence-goal.md) — parity gate for world.zig's new
// hitscan resolution (resolveHitscanFire/applyHitscanHitOnPlayer). Before
// this pass, world.zig IGNORED ResolvedFireConfig.delivery entirely and
// spawned a traveling ProjectileEntity for every build — a wizard/ninja's
// TRUE hitscan basic gun (starterWeapon.delivery === "raycast") landed its
// hit on some LATER tick under wasm prediction, while the TS authority
// resolved it INSTANTLY, same-tick, via World.ts's resolveHitscanShot/
// resolveRangedHit. That divergence is exactly what multiSeedDivergence's
// four "balanced"(=wizard) bots exercise every shot of every seed.
//
// Geometry note: aiming AT a specific world point (aimX, aimY) makes the
// ray pass through that EXACT point by construction (aimAngle is derived
// from muzzle→aim, then the ray direction is reconstructed from that same
// angle) — so placing aimY above/below the victim's centre deterministically
// controls whether the hit lands in the head band, independent of the
// muzzle's own vertical offset. See combat.zig's isHeadshotAtHalfHeight /
// player.ts's isHeadshot for the band math (top HEADSHOT_ZONE_FRAC of the
// class-scaled body height).

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
import { KILL_PLANE_MARGIN_PX, HEADSHOT_DAMAGE_MULTIPLIER } from "../../player";
import { platformToAABB } from "../../collision";
import { resolveModeConfig } from "../../data/modeConfig";
import {
  writeFireConfigsForState,
  __clearFireConfigCacheForTests,
} from "../writeFireConfigs";
import { createRuntime, stepWithRuntime } from "../../World";
import { starterWeapon } from "../../data/weapons";
import {
  InputSeq,
  PlayerId,
  Tick,
  type CharacterArchetype,
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
  id: "hitscan-parity-arena",
  name: "Hitscan Parity Arena",
  size: { x: 1600, y: 900 },
  spawns: [{ x: 700, y: 400 }],
  // Floor is far below both players — this scenario never touches the
  // ground within the 1-2 ticks it runs, so it's here only so
  // `setWorldStatics`/the TS collision cache have SOME terrain, matching
  // every other wasm-harness test's shape.
  platforms: [
    { id: "floor", kind: "floor", position: { x: 800, y: 1200 }, size: { x: 1600, y: 60 } },
  ],
};

const SHOOTER = PlayerId("shooter");
const VICTIM = PlayerId("victim");
const SHOOTER_X = 700;
// 200px — comfortably inside starterWeapon's raycast range floor (880px,
// applyDeliveryFeel's `p_range = max(p_range, 880)`).
const VICTIM_X = 900;
const Y = 400;
const STARTER_DAMAGE = starterWeapon.damage;

const FireBit = 1 << 6;

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
    ammo: 12,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    jetpackFuel: 0,
  };
}

/** `shooterAimY` controls where the ray lands vertically on the victim —
 *  see this file's header note. Both players are "balanced" (Geometrician
 *  / wizard) — starterWeapon.delivery is "raycast" for every class-blind
 *  build, and wizard/ninja/class-blind all share that same base per
 *  weapon_build.zig's class-gated `base_delivery` (Track Z1c item 1). */
function makeState(shooterAimY: number): WorldState {
  return {
    tick: Tick(0),
    rngState: 1,
    players: {
      [SHOOTER]: makePlayer(SHOOTER, SHOOTER_X, "balanced", VICTIM_X, shooterAimY),
      [VICTIM]: makePlayer(VICTIM, VICTIM_X, "balanced", VICTIM_X + 100, Y),
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

/** Run ONE tick through both orchestrators in lockstep: the shooter holds
 *  Fire (aimed per `makeState`'s `shooterAimY`), the victim does nothing.
 *  Returns each side's post-tick victim health. */
function runOneShot(shooterAimY: number): { tsHealth: number; zigHealth: number } {
  const runtime = createRuntime(MAP);
  let tsState = makeState(shooterAimY);

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

  const inputs: Record<PlayerId, InputFrame | null> = {
    [SHOOTER]: {
      seq: InputSeq(1),
      tick: Tick(1),
      keys: FireBit,
      aimX: VICTIM_X,
      aimY: shooterAimY,
      dtMs: DT_MS,
    },
    [VICTIM]: {
      seq: InputSeq(1),
      tick: Tick(1),
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
    [String(SHOOTER), { keys: FireBit, prevKeys: 0, aimX: VICTIM_X, aimY: shooterAimY }],
    [String(VICTIM), { keys: 0, prevKeys: 0, aimX: VICTIM_X + 100, aimY: Y }],
  ]);
  __clearFireConfigCacheForTests();
  writeFireConfigsForState(zigState);
  zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;

  return {
    tsHealth: tsState.players[VICTIM]!.health,
    zigHealth: zigState.players[VICTIM]!.health,
  };
}

describe("hitscan resolution parity (Track Z1c item 1)", () => {
  test("same-tick body hit — both orchestrators land the shot on tick 1, same damage", () => {
    // aimY === victim's own y ⇒ the ray passes exactly through the
    // victim's centre (well below the head band's threshold), a plain
    // body hit — no travel-time delay the way a real ProjectileEntity
    // would have (100px at 650px/s is still ~1 tick away; the point is
    // this ISN'T a projectile at all any more for a raycast build).
    const { tsHealth, zigHealth } = runOneShot(Y);
    expect(tsHealth).toBeCloseTo(100 - STARTER_DAMAGE, 9);
    expect(zigHealth).toBeCloseTo(100 - STARTER_DAMAGE, 9);
  });

  test("headshot multiplier agreement — aiming into the head band applies the SAME 1.2x boost on both sides", () => {
    // aimY well above the victim's centre (head band top sits at
    // victim.y - 28*0.5*... — see this file's header note); the ray
    // passes through that exact point, landing a headshot on both sides.
    const { tsHealth, zigHealth } = runOneShot(Y - 20);
    const expectedHealth = 100 - STARTER_DAMAGE * HEADSHOT_DAMAGE_MULTIPLIER;
    expect(tsHealth).toBeCloseTo(expectedHealth, 9);
    expect(zigHealth).toBeCloseTo(expectedHealth, 9);
    expect(zigHealth).toBeCloseTo(tsHealth, 9);
  });

  test("clean miss — aiming well away from the victim lands no hit on either side", () => {
    // Straight up: the ray never comes near the victim's hitbox at all.
    const { tsHealth, zigHealth } = runOneShot(Y - 5000);
    expect(tsHealth).toBe(100);
    expect(zigHealth).toBe(100);
  });
});
