// Track Z5 item 2 (finish-line-goal.md) — parity gate for
// `fireConfigShared.ts`'s `patchClassModifierGapFields`, the generalized
// stopgap that closes the classModifiers-codegen gap for the 8 cards that
// didn't already have one (`stolen-fangs`' `leechFraction` was the only
// card with a stopgap before this pass — `patchLeechFraction`, Track Z1c).
//
// THE GAP: `cards_gen.zig` (the codegen'd Zig card table) carries only the
// top-level class-blind `modifier` — `classModifiers` (per-class field
// overrides) never crosses at all, so `weapon_build.zig`'s resolver applies
// the WRONG (class-blind) numbers for every one of these 9 cards whenever
// a class with an authored override actually holds one.
//
// THE FIX: `patchClassModifierGapFields` recomputes the real build in TS
// (`resolvePlayerBuild`, the exact production function World.ts/weapon.ts
// use) and overwrites just the fields each card's `classModifiers` entry
// touches, straight into the wasm-side `ResolvedFireConfig` bytes — same
// "host resolves in TS, patches into wasm memory" shape the leech patch
// already established.
//
// Each case below proves REAL crossing, not a coincidental match: the
// override class's field is compared against a class with NO override for
// the SAME card (falls back to the unpatched, correctly-resolved-by-Zig
// class-blind `modifier`) — wherever the authored numbers actually differ,
// the two must read DIFFERENT bytes, and the override class's byte must
// equal the real TS-resolved number.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import { preloadWasmWorldSim, __getCachedSim, __getCachedEx } from "../worldWasmBackend";
import { RESOLVED_FIRE_CONFIG_SIZE } from "../worldStateBridge";
import { wasmHost } from "../wasmHost";
import { applyWasmPlayerFlag } from "../runtime";
import { writeFireConfigsForState, __clearFireConfigCacheForTests } from "../writeFireConfigs";
import { resolvePlayerBuild } from "../../weapon";
import { packResolvedFireConfig } from "../../data/packResolvedFireConfig";
import { createWeaponBuild, findCardsById } from "../../data/weaponBuild";
import { baseWeaponForClass } from "../../data/weapons";
import { classIdForArchetype } from "../../data/cardTypes";
import { crystalRoundsCards } from "../../data/cards";
import {
  InputSeq,
  PlayerId,
  Tick,
  type CharacterArchetype,
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

function makePlayer(id: string, characterId: CharacterArchetype, cards: string[]): PlayerEntity {
  return {
    id: PlayerId(id),
    characterId,
    x: 400,
    y: 400,
    vx: 0,
    vy: 0,
    aimX: 500,
    aimY: 400,
    health: 100,
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

/** Two players ("a", "b" — sorted, so a is index 0, b is index 1), each
 *  holding ONLY the one card under test, on the two chassis being
 *  compared. No statics/round setup needed: `writeFireConfigsForState`
 *  only touches the loadout-resolution export, never `step_world`. */
function makeState(
  archetypeA: CharacterArchetype,
  archetypeB: CharacterArchetype,
  cardId: string,
): WorldState {
  return {
    tick: Tick(0),
    rngState: 1,
    players: {
      [PlayerId("a")]: makePlayer("a", archetypeA, [cardId]),
      [PlayerId("b")]: makePlayer("b", archetypeB, [cardId]),
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

/** The RAW, chassis-UNFOLDED card-only `moveSpeedMultiplier` — matches
 *  what the patch actually writes (see `patchClassModifierGapFields`'s own
 *  doc comment: `resolvePlayerBuild` folds a chassis speed factor onto
 *  this number that `step_world`'s own `speed_mul` chain doesn't apply via
 *  this field, so asserting against the FOLDED number here would fail for
 *  any non-neutral chassis, not because the patch is wrong but because the
 *  comparison would be to the wrong TS quantity). */
function rawMoveSpeedMultiplier(player: PlayerEntity): number {
  const classId = classIdForArchetype(player.characterId);
  return createWeaponBuild(
    baseWeaponForClass(classId),
    findCardsById(crystalRoundsCards, player.cards),
    classId,
  ).moveSpeedMultiplier;
}

function configView(playerIndex: number): DataView {
  const sim = __getCachedSim()!;
  const ex = __getCachedEx() as unknown as {
    offset_player_fire_config: () => number;
    memory: WebAssembly.Memory;
  };
  const base = sim.statePtr + ex.offset_player_fire_config() + playerIndex * RESOLVED_FIRE_CONFIG_SIZE;
  return new DataView(ex.memory.buffer, base, RESOLVED_FIRE_CONFIG_SIZE);
}

/** Resolve+patch both players' configs, then hand back each side's
 *  wasm-resolved bytes AND the real TS-production numbers to compare
 *  against (`packResolvedFireConfig(resolvePlayerBuild(player))`). */
function resolveBoth(
  state: WorldState,
): {
  zigA: DataView;
  zigB: DataView;
  tsA: ReturnType<typeof packResolvedFireConfig>;
  tsB: ReturnType<typeof packResolvedFireConfig>;
} {
  __clearFireConfigCacheForTests();
  writeFireConfigsForState(state);
  return {
    zigA: configView(0),
    zigB: configView(1),
    tsA: packResolvedFireConfig(resolvePlayerBuild(state.players[PlayerId("a")]!)),
    tsB: packResolvedFireConfig(resolvePlayerBuild(state.players[PlayerId("b")]!)),
  };
}

describe("classModifiers-codegen gap fields parity (Track Z5 item 2)", () => {
  test("seeker-facets: Wizard pays the 10% damage tax, Ninja (no override) doesn't", () => {
    const { zigA, zigB, tsA, tsB } = resolveBoth(makeState("balanced", "sprinter", "seeker-facets"));
    // a = wizard, b = ninja (class-blind fallback, no classModifiers entry)
    expect(zigA.getFloat64(0, true), "wizard damage matches TS (tax applied)").toBeCloseTo(tsA.damage, 9);
    expect(zigB.getFloat64(0, true), "ninja damage matches TS (no tax, base modifier)").toBeCloseTo(tsB.damage, 9);
    expect(zigA.getFloat64(0, true), "wizard pays the tax").toBeLessThan(zigB.getFloat64(0, true));
  });

  test("cluster-bomb: Wizard's split count (3) and Paladin's shard size (1.35) both cross, differing from Ninja's base (6 / 1.12)", () => {
    const wiz = resolveBoth(makeState("balanced", "sprinter", "cluster-bomb"));
    expect(wiz.zigA.getUint32(124, true), "wizard splitCount matches TS").toBe(wiz.tsA.splitCount);
    expect(wiz.zigB.getUint32(124, true), "ninja splitCount matches TS (base)").toBe(wiz.tsB.splitCount);
    expect(wiz.zigA.getUint32(124, true), "wizard's 3 differs from ninja's base 6").toBeLessThan(
      wiz.zigB.getUint32(124, true),
    );

    const pal = resolveBoth(makeState("heavy", "sprinter", "cluster-bomb"));
    expect(pal.zigA.getFloat64(88, true), "paladin sizeMultiplier matches TS").toBeCloseTo(pal.tsA.sizeMultiplier, 9);
    expect(pal.zigB.getFloat64(88, true), "ninja sizeMultiplier matches TS (base)").toBeCloseTo(
      pal.tsB.sizeMultiplier,
      9,
    );
    expect(pal.zigA.getFloat64(88, true), "paladin's bigger chips differ from ninja's base").toBeGreaterThan(
      pal.zigB.getFloat64(88, true),
    );
  });

  test("slow-field: Priest's wider/stronger slow (92px / 0.46) crosses, differing from Ninja's base (70px / 0.58)", () => {
    const { zigA, zigB, tsA, tsB } = resolveBoth(makeState("shielded", "sprinter", "slow-field"));
    expect(zigA.getFloat64(80, true), "priest impactRadiusPx matches TS").toBeCloseTo(tsA.impactRadiusPx, 9);
    expect(zigB.getFloat64(80, true), "ninja impactRadiusPx matches TS (base)").toBeCloseTo(tsB.impactRadiusPx, 9);
    expect(zigA.getFloat64(80, true), "priest's wider radius differs from ninja's base").toBeGreaterThan(
      zigB.getFloat64(80, true),
    );

    expect(zigA.getFloat64(72, true), "priest slowMultiplier matches TS").toBeCloseTo(tsA.slowMultiplier, 9);
    expect(zigB.getFloat64(72, true), "ninja slowMultiplier matches TS (base)").toBeCloseTo(tsB.slowMultiplier, 9);
    expect(zigA.getFloat64(72, true), "priest's stronger slow differs from ninja's base").toBeLessThan(
      zigB.getFloat64(72, true),
    );
  });

  test("molten-core: Paladin's bigger ground-fire pool (58px) crosses, differing from Ninja's base (42px)", () => {
    const { zigA, zigB, tsA, tsB } = resolveBoth(makeState("heavy", "sprinter", "molten-core"));
    expect(zigA.getFloat64(80, true), "paladin impactRadiusPx matches TS").toBeCloseTo(tsA.impactRadiusPx, 9);
    expect(zigB.getFloat64(80, true), "ninja impactRadiusPx matches TS (base)").toBeCloseTo(tsB.impactRadiusPx, 9);
    expect(zigA.getFloat64(80, true), "paladin's bigger pool differs from ninja's base").toBeGreaterThan(
      zigB.getFloat64(80, true),
    );
  });

  test("frost-prism: Paladin's stronger chill (0.55) crosses, differing from Ninja's base (0.68)", () => {
    const { zigA, zigB, tsA, tsB } = resolveBoth(makeState("heavy", "sprinter", "frost-prism"));
    expect(zigA.getFloat64(72, true), "paladin slowMultiplier matches TS").toBeCloseTo(tsA.slowMultiplier, 9);
    expect(zigB.getFloat64(72, true), "ninja slowMultiplier matches TS (base)").toBeCloseTo(tsB.slowMultiplier, 9);
    expect(zigA.getFloat64(72, true), "paladin's stronger chill differs from ninja's base").toBeLessThan(
      zigB.getFloat64(72, true),
    );
  });

  test("crystal-plating: Wizard (0.97) and Paladin (0.99) move-speed costs both cross, both differing from Ninja's base (0.98); Paladin's bigger plates (1.2) differ from Ninja's base (1.14)", () => {
    const wizState = makeState("balanced", "sprinter", "crystal-plating");
    const wiz = resolveBoth(wizState);
    // moveSpeedMultiplier is compared against the RAW card-only build
    // (rawMoveSpeedMultiplier), never `tsA/tsB.moveSpeedMultiplier`
    // (resolvePlayerBuild's chassis-folded number) — see that helper's own
    // doc comment for why.
    expect(wiz.zigA.getFloat64(136, true), "wizard moveSpeedMultiplier matches TS").toBeCloseTo(
      rawMoveSpeedMultiplier(wizState.players[PlayerId("a")]!),
      9,
    );
    expect(wiz.zigB.getFloat64(136, true), "ninja moveSpeedMultiplier matches TS (base)").toBeCloseTo(
      rawMoveSpeedMultiplier(wizState.players[PlayerId("b")]!),
      9,
    );
    expect(wiz.zigA.getFloat64(136, true), "wizard's cost differs from ninja's base").not.toBeCloseTo(
      wiz.zigB.getFloat64(136, true),
      9,
    );

    const palState = makeState("heavy", "sprinter", "crystal-plating");
    const pal = resolveBoth(palState);
    expect(pal.zigA.getFloat64(136, true), "paladin moveSpeedMultiplier matches TS").toBeCloseTo(
      rawMoveSpeedMultiplier(palState.players[PlayerId("a")]!),
      9,
    );
    expect(pal.zigA.getFloat64(88, true), "paladin sizeMultiplier matches TS").toBeCloseTo(pal.tsA.sizeMultiplier, 9);
    expect(pal.zigB.getFloat64(88, true), "ninja sizeMultiplier matches TS (base)").toBeCloseTo(
      pal.tsB.sizeMultiplier,
      9,
    );
    expect(pal.zigA.getFloat64(88, true), "paladin's bigger plates differ from ninja's base").toBeGreaterThan(
      pal.zigB.getFloat64(88, true),
    );
  });

  test("spring-heel: Wizard (1.1) and Paladin (1.04) jump heights both cross, both differing from Ninja's base (1.18)", () => {
    const wiz = resolveBoth(makeState("balanced", "sprinter", "spring-heel"));
    expect(wiz.zigA.getFloat64(152, true), "wizard jumpMultiplier matches TS").toBeCloseTo(wiz.tsA.jumpMultiplier, 9);
    expect(wiz.zigB.getFloat64(152, true), "ninja jumpMultiplier matches TS (base)").toBeCloseTo(
      wiz.tsB.jumpMultiplier,
      9,
    );
    expect(wiz.zigA.getFloat64(152, true), "wizard's jump differs from ninja's base").toBeLessThan(
      wiz.zigB.getFloat64(152, true),
    );

    const pal = resolveBoth(makeState("heavy", "sprinter", "spring-heel"));
    expect(pal.zigA.getFloat64(152, true), "paladin jumpMultiplier matches TS").toBeCloseTo(pal.tsA.jumpMultiplier, 9);
    expect(pal.zigA.getFloat64(152, true), "paladin's lower jump differs from ninja's base").toBeLessThan(
      pal.zigB.getFloat64(152, true),
    );
  });

  test("double-jump: Wizard and Paladin's air-jump count both cross correctly (no numeric divergence from base today — the crossing is real regardless)", () => {
    const wiz = resolveBoth(makeState("balanced", "heavy", "double-jump"));
    expect(wiz.zigA.getUint32(216, true), "wizard airJumps matches TS").toBe(wiz.tsA.airJumps);
    expect(wiz.zigB.getUint32(216, true), "paladin airJumps matches TS").toBe(wiz.tsB.airJumps);
  });

  test("stolen-fangs: unaffected by this pass's patch (regression check — already shipped via patchLeechFraction, Track Z1c)", () => {
    const { zigA, tsA } = resolveBoth(makeState("shielded", "sprinter", "stolen-fangs"));
    expect(zigA.getFloat32(252, true), "priest leechFraction still matches TS").toBeCloseTo(tsA.leechFraction, 5);
  });
});
