// Track Z1c "six-axes axis payloads" (convergence-goal.md) — parity gate for
// the passive-Tithe leech field appended to `ResolvedFireConfig`
// (`leech_fraction`, world_state.zig offset 252) and consumed at world.zig's
// fire sites (the real-projectile spawn/hit path here; the hitscan path's
// consumption code is the same formula, see world.zig's own
// `applyHitscanHitOnPlayer` doc comment for why no real card reaches that
// combination today).
//
// SCOPE NOTE (documented, not silent): the only real card that sets
// `leechFraction` is Stolen Fangs' `classModifiers.priest` reading
// (cards.ts) — Zig's card codegen carries NO classModifiers data at all
// (weapon_build.zig's `resolve_player_fire_config` doc comment flags this
// exact gap for a different field), so a genuine end-to-end parity claim
// needs `fireConfigShared.ts`'s `patchLeechFraction` stopgap (patches this
// ONE field straight from the real `resolvePlayerBuild` TS resolution,
// bypassing the general classModifiers gap for just this field).
//
// SEPARATE, ALSO PRE-EXISTING gap this test deliberately does NOT exercise:
// weapon_build.zig's `StarterBase` resolves EVERY class from the same
// class-blind base weapon stats regardless of `character_id` (only the
// `delivery` byte is class-gated, per Track Z1c item 1's own "Deliberately
// NARROW" test note in weaponBuildParity.test.ts) — so a live Priest's
// ACTUAL tendril damage/speed/homing/count never matches between TS and
// Zig today, independent of anything this pass touches. Rather than fight
// that gap (or silently launder it into a false "parity" claim), this test
// verifies the LEECH FORMULA is self-consistent on EACH side against that
// side's OWN observed damage-dealt, rather than asserting TS's and Zig's
// damage numbers themselves match. That is exactly what this item is
// responsible for (the consumption formula + the chassis-aware cap); the
// base-stat gap is somebody else's item.

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
import { baseMaxHealthForArchetype } from "../../data/cardTypes";
import {
  writeFireConfigsForState,
  __clearFireConfigCacheForTests,
} from "../writeFireConfigs";
import { createRuntime, stepWithRuntime } from "../../World";
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
  id: "leech-parity-arena",
  name: "Leech Parity Arena",
  size: { x: 1600, y: 900 },
  spawns: [{ x: 700, y: 400 }],
  // A REAL, close floor (unlike hitscanResolveParity's deliberately-distant
  // one — that scenario only runs 1-2 ticks, so gravity never matters;
  // this one runs dozens of ticks to let a slow projectile travel + several
  // fire volleys land, so both players must actually LAND and stay put,
  // not free-fall into the kill plane).
  platforms: [
    { id: "floor", kind: "floor", position: { x: 800, y: 450 }, size: { x: 1600, y: 60 } },
  ],
};

const SHOOTER = PlayerId("shooter");
const VICTIM = PlayerId("victim");
const SHOOTER_X = 700;
const VICTIM_X = 850; // close range — well inside every weapon's reach.
const Y = 400;
// Stolen Fangs' Priest reading (cards.ts classModifiers.priest.leechFraction).
const LEECH_FRACTION = 0.08;
// crystal-plating's class-blind modifier.maxHealthAdd (cards.ts) — Priest
// has no classModifiers override for this card, so both TS and Zig resolve
// the SAME +20 (this field has no classModifiers-gap; only leechFraction
// does). Priest chassis base is 100 (cardTypes.ts CHASSIS_STATS.shielded) —
// so real max health here is 120, ABOVE the pre-fix flat-100 cap this item
// closes. Starting the shooter at 110 (between the old buggy cap and the
// real one) makes the bug/fix fully observable: the old flat-100 cap would
// produce ZERO healing here (min(100, 110) already caps below current
// health), while the chassis-aware fix allows real healing up to 120.
const SHOOTER_MAX_HEALTH = baseMaxHealthForArchetype("shielded") + 20;
const SHOOTER_START_HEALTH = 110;
const VICTIM_START_HEALTH = 100;

const FireBit = 1 << 6;

function makePlayer(
  id: PlayerId,
  x: number,
  characterId: CharacterArchetype,
  cards: string[],
  health: number,
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
    health,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards,
    fireCooldownMs: 0,
    ammo: 999,
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
      [SHOOTER]: makePlayer(
        SHOOTER,
        SHOOTER_X,
        "shielded",
        ["stolen-fangs", "crystal-plating"],
        SHOOTER_START_HEALTH,
        VICTIM_X,
        Y,
      ),
      [VICTIM]: makePlayer(VICTIM, VICTIM_X, "balanced", [], VICTIM_START_HEALTH, VICTIM_X + 100, Y),
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

/** Run N ticks through both orchestrators in lockstep: the shooter holds
 *  Fire, aimed dead-on at the (stationary) victim; the victim does nothing.
 *  Returns each side's final shooter/victim health. */
function runTicks(nTicks: number): {
  tsShooter: number;
  tsVictim: number;
  zigShooter: number;
  zigVictim: number;
} {
  const runtime = createRuntime(MAP);
  let tsState = makeState();

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

  for (let t = 1; t <= nTicks; t++) {
    const inputs: Record<PlayerId, InputFrame | null> = {
      [SHOOTER]: {
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
      [String(SHOOTER), { keys: FireBit, prevKeys: t > 1 ? FireBit : 0, aimX: VICTIM_X, aimY: Y }],
      [String(VICTIM), { keys: 0, prevKeys: 0, aimX: VICTIM_X + 100, aimY: Y }],
    ]);
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(zigState);
    zigState = applyWasmWorldStepFullSync(zigState, DT_MS).state;
  }

  return {
    tsShooter: tsState.players[SHOOTER]!.health,
    tsVictim: tsState.players[VICTIM]!.health,
    zigShooter: zigState.players[SHOOTER]!.health,
    zigVictim: zigState.players[VICTIM]!.health,
  };
}

describe("passive Tithe leech parity (Track Z1c six-axes axis payloads)", () => {
  test("both engines apply the SAME leech formula to their own damage-dealt, capped at the CHASSIS-AWARE max health (not a flat 100)", () => {
    const { tsShooter, tsVictim, zigShooter, zigVictim } = runTicks(90);

    // Sanity: a hit actually landed on both sides (otherwise the rest of
    // this test proves nothing).
    const tsDamageDealt = VICTIM_START_HEALTH - tsVictim;
    const zigDamageDealt = VICTIM_START_HEALTH - zigVictim;
    expect(tsDamageDealt, "TS damage dealt").toBeGreaterThan(0);
    expect(zigDamageDealt, "Zig damage dealt").toBeGreaterThan(0);

    // The formula itself (World.ts:2077-2084 / world.zig's mirrored leech
    // block): heal = min(maxHealthForPlayer, health + damageDealt * frac).
    // Checked against EACH side's OWN damage-dealt — see this file's header
    // note on why this isn't a TS-vs-Zig damage-magnitude comparison.
    const expectedTsShooter = Math.min(
      SHOOTER_MAX_HEALTH,
      SHOOTER_START_HEALTH + tsDamageDealt * LEECH_FRACTION,
    );
    const expectedZigShooter = Math.min(
      SHOOTER_MAX_HEALTH,
      SHOOTER_START_HEALTH + zigDamageDealt * LEECH_FRACTION,
    );
    expect(tsShooter, "TS shooter health matches its own formula").toBeCloseTo(expectedTsShooter, 6);
    // Looser precision on the Zig side: `leech_fraction` round-trips through
    // an f32 (world_state.zig's own doc comment on that field), so a
    // 0.08-ish fraction carries a tiny (~1e-7 relative) rounding error.
    expect(zigShooter, "Zig shooter health matches its own formula").toBeCloseTo(expectedZigShooter, 3);

    // The actual bug this item fixes: BOTH sides must show REAL healing
    // above the shooter's starting 110 — the pre-fix flat-100 cap
    // (`Math.max(100, health)`) would have produced ZERO heal here (110 is
    // already above 100), silently swallowing every leech tick.
    expect(tsShooter, "TS: real healing beyond the old flat-100 cap").toBeGreaterThan(SHOOTER_START_HEALTH);
    expect(zigShooter, "Zig: real healing beyond the old flat-100 cap").toBeGreaterThan(SHOOTER_START_HEALTH);
  });
});
