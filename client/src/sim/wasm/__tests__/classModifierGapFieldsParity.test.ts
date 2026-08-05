// Track E1 (gospel-goal.md "classModifiers carried in Zig codegen") — the
// SUCCESSOR to this file's Track Z5 item 2 stopgap gate. The stopgap
// (`fireConfigShared.ts`'s `patchClassModifierGapFields`, plus the earlier
// narrow `patchLeechFraction`) is DELETED, not just bypassed: nothing in
// the host patches class-gated fields into wasm memory any more. Every
// byte asserted below was written by the ZIG resolver itself.
//
// THE PORT (what closed the gap the old header described):
//   - `classModifiers` cross as per-class CardMod literals
//     (cards_gen.zig `CardEntry.class_mods`, selected by
//     `effectiveCardMod` — weaponBuild.ts's `effectiveCardModifier`
//     mirrored: an authored entry REPLACES the class-blind modifier
//     wholesale; absent classes fall back to it).
//   - `leechFraction` is a first-class CardMod field (max-fold + the
//     clampBuild 0..0.5/3dp tail), so Stolen Fangs' Priest-only leech
//     resolves in-sim.
//   - The per-class starter bases cross too (cards_gen.zig `class_bases`
//     — weapons.ts `baseWeaponForClass`: priest tendrils, paladin heavy
//     bolt), closing the "per-class starter STAT overrides remain an
//     unported, recorded gap" residual the old stopgap's damage/fireRate
//     patches were incidentally masking for two card+class combos.
//   - weapon_build.zig's merge folds now mirror mergeProjectileModifier /
//     applyCard EXACTLY (preferShape/Pathing/Element/Impact ranks, max
//     for count/homing/bounces/pierce/split/impactRadius/spread-set, min
//     for slow, extreme-|g|-wins for gravityScale, orthogonalScale for
//     the scale channels, the visible-signature bump on its own plain
//     channel) — the old direct-set folds only coincided with TS from
//     the weakest-in-every-dimension class-blind base.
//
// PROOF SHAPE: every card with an authored `classModifiers` (all 9) ×
// EVERY class (authored AND fallback) × class-blind, full-struct compare
// of the Zig resolver's bytes against TS production resolution
// (`createWeaponBuild(baseWeaponForClass(classId), [card], classId)` →
// `packResolvedFireConfig`) — the same card-layer truth
// weaponBuildParity.test.ts gates on (resolvePlayerBuild's post-card
// folds — innate ability, dash floor, chassis speed — are host-side
// layers on BOTH engines' paths, outside the resolver under test). Plus
// Zig-vs-Zig divergence checks proving each authored override actually
// LANDS (not a coincidental match), and a host-path walk proving the
// production full-sync step derives each player's class from the PACKED
// `character_id` and resolves a multi-card hand per-class in-sim.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import {
  preloadWasmWorldSim,
  __getCachedSim,
  __getCachedEx,
  applyWasmWorldStepFullSync,
  setWorldStatics,
  setWorldArenaBounds,
  setWorldLaunchPads,
  setWorldSlopes,
  setWorldSpawnPoints,
  setWorldTargetScore,
} from "../worldWasmBackend";
import { WORLD_STATE_TOTAL_SIZE, RESOLVED_FIRE_CONFIG_SIZE } from "../worldStateBridge";
import { wasmHost } from "../wasmHost";
import { applyWasmPlayerFlag } from "../runtime";
import { KILL_PLANE_MARGIN_PX } from "../../player";
import { platformToAABB } from "../../collision";
import { resolveModeConfig } from "../../data/modeConfig";
import { createWeaponBuild, findCardsById } from "../../data/weaponBuild";
import { packResolvedFireConfig } from "../../data/packResolvedFireConfig";
import { baseWeaponForClass } from "../../data/weapons";
import type { ClassId } from "../../data/cardTypes";
import { crystalRoundsCards } from "../../data/cards";
import {
  InputSeq,
  PlayerId,
  Tick,
  type CharacterArchetype,
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

const sim = __getCachedSim()!;
const ex = __getCachedEx() as unknown as {
  memory: WebAssembly.Memory;
  resolve_build_test_class: (i: number, classIdx: number, out: number) => void;
  offset_player_fire_config: () => number;
};
const SCRATCH = sim.statePtr + WORLD_STATE_TOTAL_SIZE + 4096;

// gen_card_data.ts's CLASS_ID declaration order (mirrors cardTypes.ts).
const CLASS_IDX: Record<ClassId, number> = { wizard: 0, ninja: 1, paladin: 2, priest: 3 };
const ALL_CLASSES: readonly ClassId[] = ["wizard", "ninja", "paladin", "priest"];
const ARCHETYPE_FOR_CLASS: Record<ClassId, CharacterArchetype> = {
  wizard: "balanced",
  ninja: "sprinter",
  paladin: "heavy",
  priest: "shielded",
};

const cards = crystalRoundsCards;
const CLASS_MOD_CARDS = cards
  .map((c, i) => ({ card: c, index: i }))
  .filter(({ card }) => card.classModifiers);

/** Class-AWARE Zig resolution of base+cards[i] straight from the resolver
 *  export — no host patch layer exists any more to interfere. */
function zig(i: number, classId?: ClassId): DataView {
  ex.resolve_build_test_class(i, classId === undefined ? 255 : CLASS_IDX[classId], SCRATCH);
  return new DataView(ex.memory.buffer, SCRATCH, RESOLVED_FIRE_CONFIG_SIZE);
}

function ts(cardIds: string[], classId?: ClassId) {
  return packResolvedFireConfig(
    createWeaponBuild(baseWeaponForClass(classId), findCardsById(cards, cardIds), classId),
  );
}

/** Full ResolvedFireConfig compare — same offsets/coverage as
 *  weaponBuildParity.test.ts's own `compare` (the two tables must never
 *  drift apart independently). */
function compareAll(z: DataView, t: ReturnType<typeof ts>, label: string): void {
  const F = (off: number) => z.getFloat64(off, true);
  const U32 = (off: number) => z.getUint32(off, true);
  const U8 = (off: number) => z.getUint8(off);
  const ctx = ` [${label}]`;
  expect(F(0), "damage" + ctx).toBeCloseTo(t.damage, 6);
  expect(F(8), "fireRate" + ctx).toBeCloseTo(t.fireRate, 6);
  expect(F(16), "projSpeed" + ctx).toBeCloseTo(t.projectileSpeed, 6);
  expect(F(24), "projLifetime" + ctx).toBeCloseTo(t.projectileLifetimeSeconds, 6);
  expect(F(32), "spread" + ctx).toBeCloseTo(t.spreadRadians, 6);
  expect(F(40), "rangePx" + ctx).toBeCloseTo(t.rangePx, 6);
  expect(F(48), "homing" + ctx).toBeCloseTo(t.homingStrength, 6);
  expect(F(56), "accel" + ctx).toBeCloseTo(t.accelerationMultiplier, 6);
  expect(F(64), "gravityScale" + ctx).toBeCloseTo(t.gravityScale, 6);
  expect(F(72), "slow" + ctx).toBeCloseTo(t.slowMultiplier, 6);
  expect(F(80), "impactRadius" + ctx).toBeCloseTo(t.impactRadiusPx, 6);
  expect(F(88), "size" + ctx).toBeCloseTo(t.sizeMultiplier, 6);
  expect(F(96), "speed" + ctx).toBeCloseTo(t.speedMultiplier, 6);
  expect(F(104), "lifetime" + ctx).toBeCloseTo(t.lifetimeMultiplier, 6);
  expect(U32(112), "count" + ctx).toBe(t.projectileCount);
  expect(U32(116), "bounces" + ctx).toBe(t.bounces);
  expect(U32(120), "pierce" + ctx).toBe(t.pierceCount);
  expect(U32(124), "split" + ctx).toBe(t.splitCount);
  expect(U8(128), "shape" + ctx).toBe(t.shapeIdx);
  expect(U8(129), "element" + ctx).toBe(t.elementIdx);
  expect(U8(130), "pathing" + ctx).toBe(t.pathingIdx);
  expect(U8(131), "impact" + ctx).toBe(t.impactIdx);
  expect(U8(132), "valid" + ctx).toBe(1);
  expect(F(136), "moveSpeedMul" + ctx).toBeCloseTo(t.moveSpeedMultiplier, 6);
  expect(F(144), "gravityMul" + ctx).toBeCloseTo(t.gravityMultiplier, 6);
  expect(F(152), "jumpMul" + ctx).toBeCloseTo(t.jumpMultiplier, 6);
  expect(F(160), "wallJumpMul" + ctx).toBeCloseTo(t.wallJumpMultiplier, 6);
  expect(F(168), "wallSlideMul" + ctx).toBeCloseTo(t.wallSlideMultiplier, 6);
  expect(F(176), "shieldChargeMul" + ctx).toBeCloseTo(t.shieldChargeMultiplier, 6);
  expect(F(184), "shieldRechargeMul" + ctx).toBeCloseTo(t.shieldRechargeMultiplier, 6);
  expect(F(192), "parryCoverMul" + ctx).toBeCloseTo(t.parryCoverMultiplier, 6);
  expect(F(200), "parryCooldownMul" + ctx).toBeCloseTo(t.parryCooldownMultiplier, 6);
  expect(F(208), "maxHealthAdd" + ctx).toBeCloseTo(t.maxHealthAdd, 6);
  expect(U32(216), "airJumps" + ctx).toBe(t.airJumps);
  expect(U32(220), "dashCharges" + ctx).toBe(t.dashCharges);
  expect(U8(224), "mirror" + ctx).toBe(t.mirrorShield ? 1 : 0);
  expect(U8(225), "directional" + ctx).toBe(t.directionalShield ? 1 : 0);
  expect(F(232), "dashCooldownMul" + ctx).toBeCloseTo(t.dashCooldownMultiplier, 6);
  expect(F(240), "recoilImpulse" + ctx).toBeCloseTo(t.recoilImpulse, 6);
  expect(U8(248), "delivery" + ctx).toBe(t.delivery);
  // leech_fraction round-trips through an f32 (world_state.zig) — 5
  // digits is beyond f32 noise for 0.08-scale values.
  expect(z.getFloat32(252, true), "leechFraction" + ctx).toBeCloseTo(t.leechFraction, 5);
}

describe("classModifiers codegen port (Track E1 — stopgap retired)", () => {
  test("exactly the 9 known cards carry classModifiers (walk-coverage guard)", () => {
    expect(CLASS_MOD_CARDS.map(({ card }) => card.id).sort()).toEqual(
      [
        "cluster-bomb",
        "crystal-plating",
        "double-jump",
        "frost-prism",
        "molten-core",
        "seeker-facets",
        "slow-field",
        "spring-heel",
        "stolen-fangs",
      ].sort(),
    );
  });

  test("every classModifiers card resolves byte-identically to TS for EVERY class (authored AND fallback) and class-blind", () => {
    for (const { card, index } of CLASS_MOD_CARDS) {
      for (const cls of ALL_CLASSES) {
        compareAll(zig(index, cls), ts([card.id], cls), `${card.id} (${cls})`);
      }
      compareAll(zig(index, undefined), ts([card.id], undefined), `${card.id} (class-blind)`);
    }
  });

  // Zig-vs-Zig: each authored override must actually LAND — wherever the
  // authored numbers differ from the class-blind modifier, the override
  // class's bytes must differ from a no-override class's (ninja has no
  // authored entry on any of these cards, so it always reads the class-
  // blind fallback). These are the old stopgap gate's crossing checks,
  // re-proven against pure Zig resolution.
  test("seeker-facets: Wizard pays the 10% damage tax, Ninja (fallback) doesn't", () => {
    const i = CLASS_MOD_CARDS.find(({ card }) => card.id === "seeker-facets")!.index;
    expect(zig(i, "wizard").getFloat64(0, true)).toBeLessThan(zig(i, "ninja").getFloat64(0, true));
  });
  test("cluster-bomb: Wizard's 3-split and Paladin's bigger chips both land vs Ninja's base 6 / 1.12", () => {
    const i = CLASS_MOD_CARDS.find(({ card }) => card.id === "cluster-bomb")!.index;
    expect(zig(i, "wizard").getUint32(124, true)).toBeLessThan(zig(i, "ninja").getUint32(124, true));
    expect(zig(i, "paladin").getFloat64(88, true)).toBeGreaterThan(
      zig(i, "ninja").getFloat64(88, true),
    );
  });
  test("slow-field: Priest's wider (92px) + stronger (0.46) slow lands vs Ninja's base 70px/0.58", () => {
    const i = CLASS_MOD_CARDS.find(({ card }) => card.id === "slow-field")!.index;
    expect(zig(i, "priest").getFloat64(80, true)).toBeGreaterThan(
      zig(i, "ninja").getFloat64(80, true),
    );
    expect(zig(i, "priest").getFloat64(72, true)).toBeLessThan(zig(i, "ninja").getFloat64(72, true));
  });
  test("molten-core: Paladin's bigger ground-fire pool (58px) lands vs Ninja's base 42px", () => {
    const i = CLASS_MOD_CARDS.find(({ card }) => card.id === "molten-core")!.index;
    expect(zig(i, "paladin").getFloat64(80, true)).toBeGreaterThan(
      zig(i, "ninja").getFloat64(80, true),
    );
  });
  test("frost-prism: Paladin's stronger chill (0.55) lands vs Ninja's base 0.68", () => {
    const i = CLASS_MOD_CARDS.find(({ card }) => card.id === "frost-prism")!.index;
    expect(zig(i, "paladin").getFloat64(72, true)).toBeLessThan(zig(i, "ninja").getFloat64(72, true));
  });
  test("crystal-plating: Wizard/Paladin move-speed re-tunes land vs Ninja's base 0.98", () => {
    const i = CLASS_MOD_CARDS.find(({ card }) => card.id === "crystal-plating")!.index;
    expect(zig(i, "wizard").getFloat64(136, true)).not.toBeCloseTo(
      zig(i, "ninja").getFloat64(136, true),
      9,
    );
    expect(zig(i, "paladin").getFloat64(136, true)).not.toBeCloseTo(
      zig(i, "ninja").getFloat64(136, true),
      9,
    );
  });
  test("spring-heel: Wizard (1.1) and Paladin (1.04) jump re-tunes land vs Ninja's base 1.18", () => {
    const i = CLASS_MOD_CARDS.find(({ card }) => card.id === "spring-heel")!.index;
    expect(zig(i, "wizard").getFloat64(152, true)).toBeLessThan(
      zig(i, "ninja").getFloat64(152, true),
    );
    expect(zig(i, "paladin").getFloat64(152, true)).toBeLessThan(
      zig(i, "ninja").getFloat64(152, true),
    );
  });
  test("double-jump: both authored classes cross correctly (no numeric divergence from base today — the full-struct walk above already proves the crossing is real)", () => {
    const i = CLASS_MOD_CARDS.find(({ card }) => card.id === "double-jump")!.index;
    expect(zig(i, "wizard").getUint32(216, true)).toBe(1);
    expect(zig(i, "paladin").getUint32(216, true)).toBe(1);
  });
  test("stolen-fangs: Priest's leech (0.08) resolves IN ZIG — the patchLeechFraction stopgap is gone", () => {
    const i = CLASS_MOD_CARDS.find(({ card }) => card.id === "stolen-fangs")!.index;
    expect(zig(i, "priest").getFloat32(252, true)).toBeCloseTo(0.08, 5);
    expect(zig(i, "ninja").getFloat32(252, true)).toBe(0);
  });
});

// ── Host path: class from the PACKED character_id ────────────────────────
// The production full-sync step packs the whole WorldState, THEN calls the
// Zig loadout resolver, which derives each player's class from
// `players[i].character_id` in wasm memory (fireConfigShared.ts's own
// pack-first ordering note). One step with four players — one per class —
// all holding the SAME multi-card hand must land four DIFFERENT,
// per-class, TS-identical fire configs.

const DT_MS = 1000 / 60;
const HOST_HAND = ["cluster-bomb", "stolen-fangs", "spring-heel"];
const MAP: MapDefinition = {
  id: "classmods-parity-arena",
  name: "ClassMods Parity Arena",
  size: { x: 1600, y: 900 },
  spawns: [{ x: 700, y: 400 }],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 800, y: 450 }, size: { x: 1600, y: 60 } },
  ],
};

function makePlayer(id: string, characterId: CharacterArchetype, x: number): PlayerEntity {
  return {
    id: PlayerId(id),
    characterId,
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
    cards: [...HOST_HAND],
    fireCooldownMs: 0,
    ammo: 999,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    jetpackFuel: 0,
  };
}

function hostConfigView(playerIndex: number): DataView {
  const base =
    sim.statePtr + ex.offset_player_fire_config() + playerIndex * RESOLVED_FIRE_CONFIG_SIZE;
  return new DataView(ex.memory.buffer, base, RESOLVED_FIRE_CONFIG_SIZE);
}

describe("host path derives class from the packed character_id (production full-sync ordering)", () => {
  test("four players, one per class, same hand — four per-class TS-identical resolutions", () => {
    setWorldStatics(
      MAP.platforms.map(platformToAABB),
      MAP.platforms.map((pl) => (pl.kind === "platform" ? 1 : 0)),
    );
    setWorldArenaBounds(0, MAP.size.y > 0 ? MAP.size.y + KILL_PLANE_MARGIN_PX : 0);
    setWorldLaunchPads([]);
    setWorldSlopes([]);
    setWorldSpawnPoints(MAP.spawns);
    setWorldTargetScore(resolveModeConfig(undefined).targetScore);

    // Sorted ids a..d → wasm players[0..3].
    const seats: Array<[string, ClassId]> = [
      ["a", "wizard"],
      ["b", "ninja"],
      ["c", "paladin"],
      ["d", "priest"],
    ];
    const state: WorldState = {
      tick: Tick(0),
      rngState: 1,
      players: Object.fromEntries(
        seats.map(([id, cls], i) => [
          PlayerId(id),
          makePlayer(id, ARCHETYPE_FOR_CLASS[cls], 400 + i * 200),
        ]),
      ) as Record<PlayerId, PlayerEntity>,
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

    applyWasmWorldStepFullSync(state, DT_MS);

    for (let i = 0; i < seats.length; i++) {
      const [, cls] = seats[i]!;
      compareAll(hostConfigView(i), ts(HOST_HAND, cls), `host hand (${cls})`);
    }
    // And the class-conditional numbers really differ BETWEEN seats from
    // one identical hand: paladin's 2-split vs the class-blind 6, priest's
    // leech vs everyone else's 0.
    expect(hostConfigView(2).getUint32(124, true), "paladin split").toBe(2);
    expect(hostConfigView(1).getUint32(124, true), "ninja split").toBe(6);
    expect(hostConfigView(3).getFloat32(252, true), "priest leech").toBeCloseTo(0.08, 5);
    expect(hostConfigView(0).getFloat32(252, true), "wizard leech").toBe(0);
  });
});
