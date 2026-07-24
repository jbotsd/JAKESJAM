// Track Z1a item 2 (convergence-goal.md) — class-scaled combat hitboxes
// in Zig, the mirror of cohesion-goal.md P1.4 (2026-07-23): TS's
// playerHitboxAABB/isHeadshot scale the COMBAT box by the chassis
// sizeScale (CLASS_HITBOX_SCALE_ENABLED=true in player.ts; Kindled 1.18,
// Interstice 0.92, Syzygist 1.05, Geometrician 1.0) while Zig's combat
// hit checks still used fixed body constants — a Kindled was a
// TS-only-bigger target, so any shot in the scale-delta band resolved
// hit-vs-miss DIFFERENTLY between the orchestrators.
//
// What Zig now scales (combat.zig combatHitboxScale, world.zig callers):
//   - melee arc victim box (stepMeleeSwing → combat.playerHitboxAabb)
//   - dash-through attacker/victim boxes (section 8's body-cross block)
//   - section 4's projectile-vs-player circle-vs-AABB half sizes
//   - the fire-patch overlap box
// Deliberately NOT scaled (matching TS exactly): the MOVEMENT collision
// box (player.zig — uniform across classes, traversal stays class-fair;
// see player.ts's CLASS_HITBOX_SCALE_ENABLED doc comment) and instant-AOE
// radius checks (center-distance on both sides, never a hitbox).
//
// KNOWN, DELIBERATELY-PINNED RESIDUALS (pre-existing, orthogonal to the
// scale mirror — each is its own Z1-list item, not silently absorbed
// here):
//   1. Zig's projectile path approximates the body as 30×56
//      (half_w=15) where TS uses the real 26×56 (half_w=13) — the WIDTH
//      of the box differs at the base, so side-edge grazes were already
//      non-parity before class scaling existed. This test's graze runs
//      VERTICALLY (top edge), where both bases agree at 56 tall.
//   2. CLOSED (Track Z1c item 1, 2026-07-24): Zig's projectile path now
//      applies the same HEADSHOT_DAMAGE_MULTIPLIER TS's isHeadshot does
//      (combat.zig's isHeadshotAtHalfHeight, world.zig section 4) — the
//      graze below lands in the head zone and both sides now agree at
//      90.4 (100 - 8×1.2). Residual #1 (width approximation) is
//      untouched and stays its own item.

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
import { chassisStatsForArchetype } from "../../data/cardTypes";
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
const sim = await loadSimFromBytes(ab);
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
  id: "hitbox-scale-arena",
  name: "Hitbox Scale Arena",
  size: { x: 1600, y: 900 },
  spawns: [{ x: 800, y: 400 }],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 800, y: 730 }, size: { x: 1600, y: 60 } },
  ],
};

const VICTIM = PlayerId("v0");
const VICTIM_X = 800;
const PROJ_DAMAGE = 8;
// 600 px/s at exactly 60Hz = exactly 10px per tick — chosen together with
// PROJ_START_X so the first in-range sample (x=783) is a hit for BOTH
// sides' Kindled boxes (Zig edge 782.30, TS edge 782.16 — see the margin
// math in the behavior gate) while the previous sample (x=773) is
// comfortably outside both.
const PROJ_VX = 600;
const PROJ_START_X = 653;
const PROJ_RADIUS = 2.5;
// Graze height above the victim's center: inside the Kindled box's
// vertical band (top at 28 × 1.18 = 33.04 above center) but 3px above
// the Geometrician's top (28) — more than the 2.5px radius, so the
// Geometrician is missed OUTRIGHT (no x position can ever connect:
// sqrt(r² − 3²) is imaginary). Both sides' boxes are 56 tall at base, so
// the vertical geometry is approximation-free (residual #1 above only
// affects widths).
const GRAZE_ABOVE_CENTER = 31;

function makeVictim(characterId: CharacterArchetype): PlayerEntity {
  return {
    id: VICTIM,
    characterId,
    x: VICTIM_X,
    y: 400,
    vx: 0,
    vy: 0,
    aimX: VICTIM_X + 100,
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

function makeState(characterId: CharacterArchetype): WorldState {
  return {
    tick: Tick(0),
    rngState: 1,
    players: { [VICTIM]: makeVictim(characterId) } as Record<PlayerId, PlayerEntity>,
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

/** Run the graze scenario for one victim chassis through BOTH
 *  orchestrators in lockstep; report each side's first-damage tick and
 *  final health. */
function runGraze(characterId: CharacterArchetype): {
  tsHitTick: number | null;
  zigHitTick: number | null;
  tsHealth: number;
  zigHealth: number;
} {
  const runtime = createRuntime(MAP);
  let tsState = makeState(characterId);

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

  let tsHitTick: number | null = null;
  let zigHitTick: number | null = null;
  let tsPrev = 100;
  let zigPrev = 100;

  const stepBoth = (t: number) => {
    const tsInputs: Record<PlayerId, InputFrame | null> = {
      [VICTIM]: {
        seq: InputSeq(t + 1),
        tick: Tick(t + 1),
        keys: 0,
        aimX: VICTIM_X + 100,
        aimY: 400,
        dtMs: DT_MS,
      },
    } as Record<PlayerId, InputFrame | null>;
    tsState = stepWithRuntime(tsState, runtime, tsInputs, DT_MS).state;

    (globalThis as {
      __jakesjam_wasm_inputs__?: ReadonlyMap<
        string,
        { keys: number; prevKeys: number; aimX: number; aimY: number }
      >;
    }).__jakesjam_wasm_inputs__ = new Map([
      [String(VICTIM), { keys: 0, prevKeys: 0, aimX: VICTIM_X + 100, aimY: 400 }],
    ]);
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(zigState);
    zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;
  };

  // Settle: fall from spawn, land, come to rest (movement is the same
  // wasm kernel on both sides, memory bridged since Z0e — positions are
  // kernel-identical).
  for (let t = 0; t < 40; t++) stepBoth(t);
  const yv = tsState.players[VICTIM]!.y;
  expect(Math.abs(zigState.players[VICTIM]!.y - yv)).toBeLessThan(1e-9);
  expect(tsState.players[VICTIM]!.vy).toBe(0);

  // Inject the IDENTICAL projectile into both states — a world-owned
  // (ownerId null) straight shard flying left→right at the graze height.
  const proj: ProjectileEntity = {
    id: EntityId(501),
    ownerId: null,
    x: PROJ_START_X,
    y: yv - GRAZE_ABOVE_CENTER,
    vx: PROJ_VX,
    vy: 0,
    shape: "circle",
    radius: PROJ_RADIUS,
    damage: PROJ_DAMAGE,
    lifetimeMs: 3000,
    pathing: "straight",
    element: "neutral",
    bouncesRemaining: 0,
    pierceRemaining: 0,
  };
  tsState = { ...tsState, projectiles: { [proj.id]: structuredClone(proj) } };
  zigState = { ...zigState, projectiles: { [proj.id]: structuredClone(proj) } };

  for (let t = 40; t < 80; t++) {
    stepBoth(t);
    const tsHealth = tsState.players[VICTIM]!.health;
    const zigHealth = zigState.players[VICTIM]!.health;
    if (tsHealth < tsPrev && tsHitTick === null) tsHitTick = t;
    if (zigHealth < zigPrev && zigHitTick === null) zigHitTick = t;
    tsPrev = tsHealth;
    zigPrev = zigHealth;
  }

  return {
    tsHitTick,
    zigHitTick,
    tsHealth: tsState.players[VICTIM]!.health,
    zigHealth: zigState.players[VICTIM]!.health,
  };
}

describe("class-scaled combat hitboxes (Track Z1a item 2)", () => {
  test("scale table — wasm combat_hitbox_scale matches cardTypes' CHASSIS_STATS sizeScale", () => {
    const ex = sim.exports as unknown as {
      combat_hitbox_scale?: (archetype: number) => number;
    };
    expect(typeof ex.combat_hitbox_scale).toBe("function");
    // Ordinals follow world_state.zig's CharacterArchetype enum(u8) — the
    // same CHARACTER_ARCHETYPES order the bridge packs.
    const archetypes: CharacterArchetype[] = [
      "balanced",
      "heavy",
      "sprinter",
      "shielded",
    ];
    for (let i = 0; i < archetypes.length; i++) {
      expect(ex.combat_hitbox_scale!(i)).toBe(
        chassisStatsForArchetype(archetypes[i]!).sizeScale,
      );
    }
  });

  test("graze parity — the shot that misses a Geometrician hits a Kindled at identical coordinates, both sides", () => {
    // Geometrician (scale 1.0): the graze passes 3px above the box top
    // with a 2.5px radius — clean miss, BOTH orchestrators.
    const geo = runGraze("balanced");
    expect(geo.tsHitTick).toBeNull();
    expect(geo.zigHitTick).toBeNull();
    expect(geo.tsHealth).toBe(100);
    expect(geo.zigHealth).toBe(100);

    // Kindled (scale 1.18): the same coordinates sit INSIDE the scaled
    // box's vertical band (33.04 > 31) — hit, BOTH orchestrators, on the
    // SAME tick (vertical geometry is base-identical; the sample/edge
    // margins are chosen so the residual 30-vs-26 WIDTH approximation
    // can't skew the tick: first in-band sample x=783 clears the Zig
    // edge 782.30 by 0.70px and the TS edge 782.16 by 0.84px, and the
    // previous sample x=773 is >9px outside both).
    // Pre-Z1a-item-2 this was the parity bug: TS hit (90.4), Zig MISSED
    // (100) — the Kindled was a bigger target on one side only.
    const kin = runGraze("heavy");
    expect(kin.tsHitTick).not.toBeNull();
    expect(kin.zigHitTick).toBe(kin.tsHitTick);
    // Residual #2 CLOSED (header): the graze lands in the head band, so
    // BOTH sides now apply HEADSHOT_DAMAGE_MULTIPLIER (1.2 → 9.6 damage,
    // 90.4 final health).
    expect(kin.tsHealth).toBeCloseTo(100 - PROJ_DAMAGE * HEADSHOT_DAMAGE_MULTIPLIER, 9);
    expect(kin.zigHealth).toBeCloseTo(100 - PROJ_DAMAGE * HEADSHOT_DAMAGE_MULTIPLIER, 9);
  });
});
